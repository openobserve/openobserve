// Copyright 2026 OpenObserve Inc.

import { describe, it, expect, afterEach } from "vitest";
import { mount, VueWrapper } from "@vue/test-utils";
import OTime from "./OTime.vue";

describe("OTime", () => {
  let wrapper: VueWrapper;

  afterEach(() => {
    wrapper?.unmount();
  });

  it("renders a time input", () => {
    wrapper = mount(OTime);
    const input = wrapper.find("input");
    expect(input.exists()).toBe(true);
    expect(input.attributes("type")).toBe("time");
  });

  it("renders the label", () => {
    wrapper = mount(OTime, { props: { label: "Meeting time" } });
    expect(wrapper.text()).toContain("Meeting time");
  });

  it("emits update:modelValue on change", async () => {
    wrapper = mount(OTime);
    const input = wrapper.find("input");
    await input.setValue("14:30");
    const emitted = wrapper.emitted("update:modelValue");
    expect(emitted).toBeTruthy();
    expect(emitted![0][0]).toBe("14:30");
  });

  it("uses step=60 by default", () => {
    wrapper = mount(OTime);
    expect(wrapper.find("input").attributes("step")).toBe("60");
  });

  it("uses step=1 when withSeconds is enabled", () => {
    wrapper = mount(OTime, { props: { withSeconds: true } });
    expect(wrapper.find("input").attributes("step")).toBe("1");
  });

  it("respects an explicit step prop", () => {
    wrapper = mount(OTime, { props: { step: 300 } });
    expect(wrapper.find("input").attributes("step")).toBe("300");
  });

  it("renders an error message", () => {
    wrapper = mount(OTime, { props: { errorMessage: "Pick a time" } });
    expect(wrapper.text()).toContain("Pick a time");
  });

  it("renders a clear button when clearable and value set", () => {
    wrapper = mount(OTime, {
      props: { clearable: true, modelValue: "12:00" },
    });
    expect(wrapper.find('[aria-label="Clear"]').exists()).toBe(true);
  });

  it("emits an empty value when cleared", async () => {
    wrapper = mount(OTime, {
      props: { clearable: true, modelValue: "12:00" },
    });
    await wrapper.find('[aria-label="Clear"]').trigger("click");
    expect(wrapper.emitted("update:modelValue")![0][0]).toBe("");
  });

  it("disables the input", () => {
    wrapper = mount(OTime, { props: { disabled: true } });
    expect(wrapper.find("input").attributes("disabled")).toBeDefined();
  });
});
