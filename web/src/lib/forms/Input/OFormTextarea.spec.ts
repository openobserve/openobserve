// Copyright 2026 OpenObserve Inc.

import { describe, it, expect, afterEach } from "vitest";
import { mount, VueWrapper } from "@vue/test-utils";
import OFormTextarea from "./OFormTextarea.vue";
import OForm from "../Form/OForm.vue";

describe("OFormTextarea", () => {
  let wrapper: VueWrapper;

  afterEach(() => {
    wrapper?.unmount();
  });

  it("renders inside OForm without errors", () => {
    wrapper = mount(OForm, {
      props: { defaultValues: { description: "" } },
      slots: {
        default: '<OFormTextarea name="description" />',
      },
      global: {
        components: { OFormTextarea },
      },
    });
    expect(wrapper.exists()).toBe(true);
    expect(wrapper.find("textarea").exists()).toBe(true);
  });

  it("renders a label when provided", () => {
    wrapper = mount(OForm, {
      props: { defaultValues: { notes: "" } },
      slots: {
        default: '<OFormTextarea name="notes" label="Notes" />',
      },
      global: {
        components: { OFormTextarea },
      },
    });
    expect(wrapper.find("label").text()).toBe("Notes");
  });
});
