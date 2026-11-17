// Copyright 2026 OpenObserve Inc.

import { describe, it, expect, afterEach, vi } from "vitest";
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
  it("never submits the previous time while a typed time is unreadable (V-N3)", async () => {
    const onSubmit = vi.fn();
    wrapper = mount(OForm, {
      attachTo: document.body,
      props: { defaultValues: { meet: "10:00" }, onSubmit },
      slots: {
        default: () => h(OFormTime, { name: "meet", format24: true }),
      },
      global: { components: { OFormTime } },
    });
    const form = (
      wrapper.vm as unknown as {
        form: { handleSubmit: () => Promise<unknown>; state: { canSubmit: boolean } };
      }
    ).form;
    const input = wrapper.find('input[type="text"]');
    (input.element as HTMLInputElement).value = "99:99";
    await input.trigger("change");
    await flushPromises();
    expect(form.state.canSubmit).toBe(false);
    await form.handleSubmit();
    await flushPromises();
    expect(onSubmit).not.toHaveBeenCalled();
    expect(wrapper.get('[role="alert"]').text()).toBe("Enter a time as HH:MM.");

    (input.element as HTMLInputElement).value = "11:30";
    await input.trigger("change");
    await flushPromises();
    expect(form.state.canSubmit).toBe(true);
    await form.handleSubmit();
    await flushPromises();
    expect(onSubmit).toHaveBeenCalledWith({ meet: "11:30" });
  });

  it("clears the refusal when the same time as before is typed back (V-N3)", async () => {
    const onSubmit = vi.fn();
    wrapper = mount(OForm, {
      attachTo: document.body,
      props: { defaultValues: { meet: "10:00" }, onSubmit },
      slots: {
        default: () => h(OFormTime, { name: "meet", format24: true }),
      },
      global: { components: { OFormTime } },
    });
    const form = (wrapper.vm as unknown as { form: { handleSubmit: () => Promise<unknown> } }).form;
    const input = wrapper.find('input[type="text"]');
    (input.element as HTMLInputElement).value = "ab";
    await input.trigger("change");
    (input.element as HTMLInputElement).value = "10:00";
    await input.trigger("change");
    await flushPromises();
    await form.handleSubmit();
    await flushPromises();
    expect(onSubmit).toHaveBeenCalledWith({ meet: "10:00" });
  });
});
