// Copyright 2026 OpenObserve Inc.

import { describe, it, expect, afterEach } from "vitest";
import { mount, VueWrapper } from "@vue/test-utils";
import ORadioGroup from "./ORadioGroup.vue";
import ORadio from "./ORadio.vue";

/**
 * ORadio requires RadioGroupRoot context — always mount inside ORadioGroup.
 */
function mountRadioInGroup(
  props: Record<string, unknown> = {},
  radioProps: Record<string, unknown> = {},
) {
  return mount(ORadioGroup, {
    props: { modelValue: "", ...props },
    slots: {
      default: `<ORadio value="a" label="Option A" ${Object.entries(radioProps)
        .map(([k, v]) => `:${k}="${v}"`)
        .join(" ")} />`,
    },
    global: { components: { ORadio } },
  });
}

describe("ORadio", () => {
  let wrapper: VueWrapper;

  afterEach(() => {
    wrapper?.unmount();
  });

  it("renders without errors inside a group", () => {
    wrapper = mountRadioInGroup();
    expect(wrapper.exists()).toBe(true);
  });

  it("renders the label", () => {
    wrapper = mountRadioInGroup();
    expect(wrapper.text()).toContain("Option A");
  });

  it("renders a RadioGroupItem button", () => {
    wrapper = mountRadioInGroup();
    expect(wrapper.find("button").exists()).toBe(true);
  });

  it("supports val alias on ORadio", async () => {
    wrapper = mount(ORadioGroup, {
      props: { modelValue: "" },
      slots: {
        default: '<ORadio val="alias-value" label="Alias" />',
      },
      global: { components: { ORadio } },
    });

    await wrapper.find("button").trigger("click");
    expect(wrapper.emitted("update:modelValue")?.[0]?.[0]).toBe("alias-value");
  });

  it("supports xs size", () => {
    wrapper = mount(ORadioGroup, {
      props: { modelValue: "" },
      slots: {
        default: '<ORadio value="a" size="xs" label="XS" />',
      },
      global: { components: { ORadio } },
    });

    expect(wrapper.find("button").classes()).toContain("tw:size-3");
  });
});

describe("ORadioGroup", () => {
  let wrapper: VueWrapper;

  afterEach(() => {
    wrapper?.unmount();
  });

  it("renders without errors", () => {
    wrapper = mount(ORadioGroup);
    expect(wrapper.exists()).toBe(true);
  });

  it("emits update:modelValue when a radio is clicked", async () => {
    wrapper = mount(ORadioGroup, {
      props: { modelValue: "" },
      slots: {
        default: [
          '<ORadio value="a" label="A" />',
          '<ORadio value="b" label="B" />',
        ],
      },
      global: { components: { ORadio } },
    });
    await wrapper.findAll("button")[0].trigger("click");
    const emitted = wrapper.emitted("update:modelValue");
    expect(emitted).toBeTruthy();
    expect(emitted![0][0]).toBe("a");
  });

  it("preserves numeric value type on emit", async () => {
    wrapper = mount(ORadioGroup, {
      props: { modelValue: 0 },
      slots: {
        default: '<ORadio :value="2" label="Two" />',
      },
      global: { components: { ORadio } },
    });

    await wrapper.find("button").trigger("click");
    const emitted = wrapper.emitted("update:modelValue");
    expect(emitted).toBeTruthy();
    expect(typeof emitted![0][0]).toBe("number");
    expect(emitted![0][0]).toBe(2);
  });

  it("renders vertical layout by default", () => {
    wrapper = mount(ORadioGroup);
    expect(wrapper.find("div[role]").classes()).toContain("tw:flex-col");
  });

  it("renders horizontal layout when orientation is horizontal", () => {
    wrapper = mount(ORadioGroup, {
      props: { orientation: "horizontal" },
    });
    expect(wrapper.find("div[role]").classes()).toContain("tw:flex-row");
  });
});
