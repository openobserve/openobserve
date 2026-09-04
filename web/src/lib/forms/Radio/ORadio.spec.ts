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

    expect(wrapper.find("button").classes()).toContain("size-3");
  });

  it("renders the card variant as one selectable surface", async () => {
    wrapper = mount(ORadioGroup, {
      props: { modelValue: "" },
      slots: {
        default: `
          <ORadio value="manifest" variant="card" data-test="radio-card">
            <template #label>
              <strong>Create with manifest</strong>
              <span>Recommended setup</span>
            </template>
          </ORadio>
        `,
      },
      global: { components: { ORadio } },
    });

    const surface = wrapper.find("label");
    expect(surface.attributes("data-variant")).toBe("card");
    expect(surface.find('[role="radio"]').exists()).toBe(true);

    await surface.trigger("click");
    expect(wrapper.emitted("update:modelValue")?.[0]?.[0]).toBe("manifest");
  });

  it("keeps the default radio layout unchanged", () => {
    wrapper = mountRadioInGroup();
    expect(wrapper.find("label").attributes("data-variant")).toBeUndefined();
  });
});
