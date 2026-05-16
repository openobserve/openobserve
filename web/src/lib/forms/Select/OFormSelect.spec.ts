// Copyright 2026 OpenObserve Inc.

import { describe, it, expect, afterEach } from "vitest";
import { mount, VueWrapper } from "@vue/test-utils";
import OFormSelect from "./OFormSelect.vue";
import OForm from "../Form/OForm.vue";

describe("OFormSelect", () => {
  let wrapper: VueWrapper;

  afterEach(() => {
    wrapper?.unmount();
  });

  it("renders inside OForm without errors", () => {
    wrapper = mount(OForm, {
      props: { defaultValues: { kind: "" } },
      slots: {
        default:
          "<OFormSelect name=\"kind\" :options=\"[{label:'A',value:'a'}]\" />",
      },
      global: {
        components: { OFormSelect },
      },
    });
    expect(wrapper.exists()).toBe(true);
  });

  it("renders a label when provided", () => {
    wrapper = mount(OForm, {
      props: { defaultValues: { kind: "" } },
      slots: {
        default: '<OFormSelect name="kind" label="Kind" :options="[]" />',
      },
      global: {
        components: { OFormSelect },
      },
    });
    expect(wrapper.find("label").text()).toBe("Kind");
  });
});
