// Copyright 2026 OpenObserve Inc.

import { describe, it, expect, afterEach } from "vitest";
import { mount, VueWrapper, flushPromises } from "@vue/test-utils";
import { h } from "vue";
import OFormDate from "./OFormDate.vue";
import OForm from "../Form/OForm.vue";

describe("OFormDate", () => {
  let wrapper: VueWrapper;

  afterEach(() => {
    wrapper?.unmount();
  });

  it("renders inside OForm without errors", () => {
    wrapper = mount(OForm, {
      props: { defaultValues: { dob: "2024-01-01" } },
      slots: {
        default: () => h(OFormDate, { name: "dob", label: "DOB" }),
      },
      global: { components: { OFormDate } },
    });
    expect(wrapper.exists()).toBe(true);
    expect(wrapper.find("input[type='date']").exists()).toBe(true);
  });

  it("propagates default value", () => {
    wrapper = mount(OForm, {
      props: { defaultValues: { dob: "2025-05-11" } },
      slots: {
        default: () => h(OFormDate, { name: "dob" }),
      },
      global: { components: { OFormDate } },
    });
    expect((wrapper.find("input").element as HTMLInputElement).value).toBe(
      "2025-05-11",
    );
  });

  it("shows validator error after change", async () => {
    wrapper = mount(OForm, {
      props: { defaultValues: { dob: "" } },
      slots: {
        default: () =>
          h(OFormDate, {
            name: "dob",
            validators: [(v: string) => (!v ? "Required" : undefined)],
          }),
      },
      global: { components: { OFormDate } },
    });
    const input = wrapper.find("input");
    await input.setValue("");
    await input.trigger("blur");
    await flushPromises();
    expect(wrapper.text()).toContain("Required");
  });
});
