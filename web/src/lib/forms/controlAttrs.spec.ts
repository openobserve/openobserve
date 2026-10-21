// Copyright 2026 OpenObserve Inc.

import { describe, it, expect, afterEach, vi } from "vitest";
import { mount, VueWrapper } from "@vue/test-utils";
import OSelect from "./Select/OSelect.vue";
import OInput from "./Input/OInput.vue";
import OSwitch from "./Switch/OSwitch.vue";
import OSearchInput from "./SearchInput/OSearchInput.vue";
import { splitControlAttrs, warnIfUnlabelled } from "./controlAttrs";

describe("splitControlAttrs", () => {
  it("routes aria attrs to the control and the rest to the wrapper", () => {
    const { controlAttrs, wrapperAttrs } = splitControlAttrs({
      "aria-label": "x",
      class: "a",
      "data-test": "d",
      tabindex: 0,
    });
    expect(controlAttrs).toEqual({ "aria-label": "x" });
    expect(wrapperAttrs).toEqual({ class: "a", "data-test": "d" });
  });
});

describe("aria attribute forwarding", () => {
  let wrapper: VueWrapper;
  afterEach(() => wrapper?.unmount());

  it("OInput puts aria-label on the input, not the wrapper", () => {
    wrapper = mount(OInput, { attrs: { "aria-label": "Name" } });
    expect(wrapper.find("input").attributes("aria-label")).toBe("Name");
    expect(wrapper.attributes("aria-label")).toBeUndefined();
  });

  it("OInput inside label is a real label for the input", () => {
    wrapper = mount(OInput, { props: { label: "Name", labelPosition: "inside" } });
    const label = wrapper.find("label");
    expect(label.attributes("for")).toBe(wrapper.find("input").attributes("id"));
  });

  it("OSwitch puts aria-label on the switch button", () => {
    wrapper = mount(OSwitch, { attrs: { "aria-label": "Histogram" } });
    expect(wrapper.find('[role="switch"]').attributes("aria-label")).toBe("Histogram");
    expect(wrapper.attributes("aria-label")).toBeUndefined();
  });

  it("OSelect puts aria-label on the combobox trigger", () => {
    wrapper = mount(OSelect, { attrs: { "aria-label": "Stream type" } });
    expect(wrapper.find("button").attributes("aria-label")).toBe("Stream type");
    expect(wrapper.attributes("aria-label")).toBeUndefined();
  });

  it("OSelect links its error to the trigger", () => {
    wrapper = mount(OSelect, { props: { error: true, errorMessage: "Required" } });
    const describedBy = wrapper.find("button").attributes("aria-describedby");
    expect(wrapper.find(`[id="${describedBy}"]`).text()).toBe("Required");
  });

  it("OSearchInput puts aria-label on the input", () => {
    wrapper = mount(OSearchInput, { attrs: { "aria-label": "Search streams" } });
    expect(wrapper.find("input").attributes("aria-label")).toBe("Search streams");
  });
});

describe("warnIfUnlabelled", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("warns in development when a control has no name", () => {
    vi.stubEnv("MODE", "development");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    warnIfUnlabelled("OSelect", false);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("OSelect"));
  });

  it("stays quiet for a named control and under test", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.stubEnv("MODE", "development");
    warnIfUnlabelled("OSelect", true);
    vi.stubEnv("MODE", "test");
    warnIfUnlabelled("OSelect", false);
    expect(warn).not.toHaveBeenCalled();
  });

  it("OSelect warns when mounted without a label or aria name", () => {
    vi.stubEnv("MODE", "development");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    mount(OSelect).unmount();
    mount(OSelect, { props: { label: "Country" } }).unmount();
    expect(warn).toHaveBeenCalledTimes(1);
  });
});
