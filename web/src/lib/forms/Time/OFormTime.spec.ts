// Copyright 2026 OpenObserve Inc.

import { describe, it, expect, afterEach } from "vitest";
import { mount, VueWrapper, flushPromises } from "@vue/test-utils";
import { h } from "vue";
import OFormTime from "./OFormTime.vue";
import OForm from "../Form/OForm.vue";
import { z } from "zod";

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

  it("shows schema error after submit when empty", async () => {
    wrapper = mount(OForm, {
      props: {
        defaultValues: { meet: "" },
        schema: z.object({ meet: z.string().min(1, "Required") }),
      },
      slots: {
        default: () => h(OFormTime, { name: "meet" }),
      },
      global: { components: { OFormTime } },
    });

    // OTime uses a custom clock popup (no native <input>). Drive the schema
    // through OForm's exposed TanStack form (submit-then-change reveals errors).
    await (
      wrapper.vm as unknown as { form: { handleSubmit: () => Promise<unknown> } }
    ).form.handleSubmit();
    await flushPromises();

    expect(wrapper.text()).toContain("Required");
  });
});
