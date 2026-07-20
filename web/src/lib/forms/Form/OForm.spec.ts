// Copyright 2026 OpenObserve Inc.

import { describe, it, expect, afterEach, vi } from "vitest";
import { mount, VueWrapper, flushPromises } from "@vue/test-utils";
import { h } from "vue";
import OForm from "./OForm.vue";
import OFormInput from "../Input/OFormInput.vue";
import { z } from "zod";

describe("OForm", () => {
  let wrapper: VueWrapper;

  afterEach(() => {
    wrapper?.unmount();
  });

  it("renders a form element", () => {
    wrapper = mount(OForm, {
      props: { defaultValues: { name: "" } },
    });
    expect(wrapper.find("form").exists()).toBe(true);
  });

  it("renders slot content", () => {
    wrapper = mount(OForm, {
      props: { defaultValues: {} },
      slots: { default: "<span>form content</span>" },
    });
    expect(wrapper.text()).toContain("form content");
  });

  it("calls handleSubmit on form submit", async () => {
    wrapper = mount(OForm, {
      props: { defaultValues: { value: "test" } },
    });
    await wrapper.find("form").trigger("submit");
    expect(wrapper.exists()).toBe(true);
  });

  describe("legacy-compatibility ref methods", () => {
    function mountWithRequiredField(
      initial = "",
      onSubmit?: (_v: unknown) => unknown,
    ) {
      return mount(OForm, {
        props: {
          defaultValues: { name: initial },
          schema: z.object({ name: z.string().trim().min(1, "Required") }),
          ...(onSubmit ? { onSubmit } : {}),
        },
        slots: {
          default: () => h(OFormInput, { name: "name" }),
        },
        global: { components: { OFormInput } },
      });
    }

    it("exposes validate(), resetValidation(), submit(), reset()", () => {
      wrapper = mount(OForm, { props: { defaultValues: { v: 1 } } });
      expect(typeof (wrapper.vm as unknown as { validate: unknown }).validate)
        .toBe("function");
      expect(
        typeof (wrapper.vm as unknown as { resetValidation: unknown })
          .resetValidation,
      ).toBe("function");
      expect(typeof (wrapper.vm as unknown as { submit: unknown }).submit)
        .toBe("function");
      expect(typeof (wrapper.vm as unknown as { reset: unknown }).reset)
        .toBe("function");
    });

    // Schema-only: the form schema (not per-field validators) gates submit.
    // `validate()` deliberately does NOT run a form-level schema, so validity is
    // checked via the real submit path (handleSubmit → form.state.isValid).
    it("schema marks the form invalid on submit when a required field is empty", async () => {
      wrapper = mountWithRequiredField("");
      const vm = wrapper.vm as unknown as {
        form: { handleSubmit: () => Promise<unknown>; state: { isValid: boolean } };
      };
      await vm.form.handleSubmit();
      await flushPromises();
      expect(vm.form.state.isValid).toBe(false);
    });

    it("schema passes on submit when the required field is filled", async () => {
      wrapper = mountWithRequiredField("Alice");
      const vm = wrapper.vm as unknown as {
        form: { handleSubmit: () => Promise<unknown>; state: { isValid: boolean } };
      };
      await vm.form.handleSubmit();
      await flushPromises();
      expect(vm.form.state.isValid).toBe(true);
    });

    it("resetValidation() clears displayed errors", async () => {
      wrapper = mountWithRequiredField("");
      const vm = wrapper.vm as unknown as {
        form: { handleSubmit: () => Promise<unknown> };
        resetValidation: () => void;
      };
      // First submit reveals the schema error (submit-then-change model).
      await vm.form.handleSubmit();
      await flushPromises();
      expect(wrapper.text()).toContain("Required");
      vm.resetValidation();
      await flushPromises();
      expect(wrapper.text()).not.toContain("Required");
    });

    it("submitting calls the awaited onSubmit handler when valid", async () => {
      const onSubmit = vi.fn();
      wrapper = mountWithRequiredField("Alice", onSubmit);
      // Drive the awaited form.handleSubmit() — the exposed submit() is
      // fire-and-forget, so awaiting the chain here keeps the test deterministic.
      const vm = wrapper.vm as unknown as {
        form: { handleSubmit: () => Promise<unknown> };
      };
      await vm.form.handleSubmit();
      await flushPromises();
      expect(onSubmit).toHaveBeenCalledTimes(1);
      expect(onSubmit).toHaveBeenCalledWith({ name: "Alice" });
    });

    it("reset() emits the reset event", async () => {
      wrapper = mountWithRequiredField("Alice");
      const vm = wrapper.vm as unknown as { reset: () => void };
      vm.reset();
      await flushPromises();
      expect(wrapper.emitted("reset")).toBeTruthy();
    });
  });
});
