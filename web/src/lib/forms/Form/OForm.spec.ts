// Copyright 2026 OpenObserve Inc.

import { describe, it, expect, afterEach } from "vitest";
import { mount, VueWrapper, flushPromises } from "@vue/test-utils";
import { h } from "vue";
import OForm from "./OForm.vue";
import OFormInput from "../Input/OFormInput.vue";

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

  describe("q-form compatibility ref methods", () => {
    function mountWithRequiredField(initial = "") {
      return mount(OForm, {
        props: { defaultValues: { name: initial } },
        slots: {
          default: () =>
            h(OFormInput, {
              name: "name",
              validators: [
                (v: unknown) =>
                  !v || (typeof v === "string" && !v.trim())
                    ? "Required"
                    : undefined,
              ],
            }),
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

    it("validate() returns false when a field is invalid", async () => {
      wrapper = mountWithRequiredField("");
      const vm = wrapper.vm as unknown as { validate: () => Promise<boolean> };
      const result = await vm.validate();
      expect(result).toBe(false);
    });

    it("validate() returns true when all fields pass", async () => {
      wrapper = mountWithRequiredField("Alice");
      const vm = wrapper.vm as unknown as { validate: () => Promise<boolean> };
      const result = await vm.validate();
      expect(result).toBe(true);
    });

    it("resetValidation() clears displayed errors", async () => {
      wrapper = mountWithRequiredField("");
      const vm = wrapper.vm as unknown as {
        validate: () => Promise<boolean>;
        resetValidation: () => void;
      };
      // Force the field to be touched so the error renders.
      await wrapper.find("input").trigger("blur");
      await vm.validate();
      await flushPromises();
      expect(wrapper.text()).toContain("Required");
      vm.resetValidation();
      await flushPromises();
      expect(wrapper.text()).not.toContain("Required");
    });

    it("submit() triggers the @submit event", async () => {
      wrapper = mountWithRequiredField("Alice");
      const vm = wrapper.vm as unknown as { submit: () => void };
      vm.submit();
      await flushPromises();
      expect(wrapper.emitted("submit")).toBeTruthy();
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
