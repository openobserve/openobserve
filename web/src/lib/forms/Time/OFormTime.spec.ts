// Copyright 2026 OpenObserve Inc.

import { describe, it, expect, afterEach } from "vitest";
import { mount, VueWrapper, flushPromises } from "@vue/test-utils";
import { h } from "vue";
import OFormTime from "./OFormTime.vue";
import OForm from "../Form/OForm.vue";

describe("OFormTime", () => {
  let wrapper: VueWrapper;

  afterEach(() => {
    wrapper?.unmount();
  });

  it("renders inside OForm without errors", () => {
    wrapper = mount(OForm, {
      props: { defaultValues: { meet: "10:00" } },
      slots: {
        default: () => h(OFormTime, { name: "meet", label: "Meet" }),
      },
      global: { components: { OFormTime } },
    });
    expect(wrapper.exists()).toBe(true);
    expect(wrapper.find("input[type='time']").exists()).toBe(true);
  });

  it("shows validator error after change", async () => {
    wrapper = mount(OForm, {
      props: { defaultValues: { meet: "" } },
      slots: {
        default: () =>
          h(OFormTime, {
            name: "meet",
            validators: [(v: string) => (!v ? "Required" : undefined)],
          }),
      },
      global: { components: { OFormTime } },
    });
    const input = wrapper.find("input");
    await input.setValue("");
    await input.trigger("blur");
    await flushPromises();
    expect(wrapper.text()).toContain("Required");
  });
});
