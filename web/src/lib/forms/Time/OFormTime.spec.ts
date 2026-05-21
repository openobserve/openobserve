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
    // OTime renders a custom clock trigger (role="group"), not <input type="time">
    expect(wrapper.find('[role="group"]').exists()).toBe(true);
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

    // OTime uses a custom clock popup (no native <input>).
    // Use OForm's publicly exposed TanStack form API to exercise validation.
    const formRef = wrapper.vm as unknown as { form: { setFieldValue: (n: string, v: string) => void; validateField: (n: string, c: string) => Promise<unknown>; getFieldMeta: (n: string) => Record<string, unknown>; setFieldMeta: (n: string, u: Record<string, unknown>) => void } };

    // Trigger onChange validation with an empty value
    formRef.form.setFieldValue("meet", "");
    await formRef.form.validateField("meet", "change");

    // Mark field as touched so the error message is displayed
    const meta = formRef.form.getFieldMeta("meet") as Record<string, unknown>;
    formRef.form.setFieldMeta("meet", { ...meta, isTouched: true });
    await flushPromises();

    expect(wrapper.text()).toContain("Required");
  });
});
