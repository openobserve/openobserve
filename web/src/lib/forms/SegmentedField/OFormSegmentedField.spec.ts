// Copyright 2026 OpenObserve Inc.

import { describe, it, expect, afterEach } from "vitest";
import { mount, VueWrapper, flushPromises } from "@vue/test-utils";
import { h } from "vue";
import OFormSegmentedField from "./OFormSegmentedField.vue";
import OForm from "../Form/OForm.vue";
import { z } from "zod";
import { raw } from "@/types/i18n";

describe("OFormSegmentedField", () => {
  let wrapper: VueWrapper;

  afterEach(() => {
    wrapper?.unmount();
  });

  it("renders the form value in the field", () => {
    wrapper = mount(OForm, {
      props: { defaultValues: { at: "13:47:03" } },
      slots: { default: () => h(OFormSegmentedField, { name: "at", pattern: "time" }) },
    });
    expect((wrapper.find("input").element as HTMLInputElement).value).toBe("13:47:03");
  });

  it("writes a whole-value fill back to the form", async () => {
    let submitted: unknown = null;
    wrapper = mount(OForm, {
      props: {
        defaultValues: { at: "" },
        onSubmit: (values: unknown) => {
          submitted = values;
        },
      },
      slots: { default: () => h(OFormSegmentedField, { name: "at", pattern: "time" }) },
    });
    await wrapper.find("input").setValue("09:05");
    await wrapper.find("form").trigger("submit");
    await flushPromises();
    expect(submitted).toEqual({ at: "09:05:00" });
  });

  it("marks a date outside min/max as an error while keeping it in the form", async () => {
    let submitted: unknown = null;
    wrapper = mount(OForm, {
      props: {
        defaultValues: { day: "" },
        onSubmit: (values: unknown) => {
          submitted = values;
        },
      },
      slots: {
        default: () =>
          h(OFormSegmentedField, {
            name: "day",
            pattern: "date",
            max: "2026-11-06",
            outOfRangeMessage: raw("Pick a day up to Nov 6"),
          }),
      },
    });
    await wrapper.find("input").setValue("2030-01-05");
    await flushPromises();
    expect(wrapper.find('[data-test="o-segmented-field-error"]').text()).toBe(
      "Pick a day up to Nov 6",
    );
    expect(wrapper.find("input").attributes("aria-invalid")).toBe("true");
    await wrapper.find("form").trigger("submit");
    await flushPromises();
    expect(submitted).toEqual({ day: "2030-01-05" });
  });

  it("shows the schema error under the field", async () => {
    wrapper = mount(OForm, {
      props: {
        defaultValues: { at: "" },
        schema: z.object({ at: z.string().min(1, "Required") }),
      },
      slots: { default: () => h(OFormSegmentedField, { name: "at", pattern: "time" }) },
    });
    await wrapper.find("form").trigger("submit");
    await flushPromises();
    expect(wrapper.find('[data-test="o-segmented-field-error"]').text()).toBe("Required");
    expect(wrapper.find("input").attributes("aria-invalid")).toBe("true");
  });
});
