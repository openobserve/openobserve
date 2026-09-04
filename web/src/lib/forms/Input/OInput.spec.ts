// Copyright 2026 OpenObserve Inc.

import { describe, it, expect, afterEach, vi } from "vitest";
import { mount, VueWrapper } from "@vue/test-utils";
import OInput from "./OInput.vue";

describe("OInput", () => {
  let wrapper: VueWrapper;

  afterEach(() => {
    wrapper?.unmount();
  });

  it("renders without errors", () => {
    wrapper = mount(OInput);
    expect(wrapper.exists()).toBe(true);
  });

  it("renders a text input by default", () => {
    wrapper = mount(OInput);
    expect(wrapper.find("input").attributes("type")).toBe("text");
  });

  it("renders a textarea when type is textarea", () => {
    wrapper = mount(OInput, { props: { type: "textarea" } });
    expect(wrapper.find("textarea").exists()).toBe(true);
    expect(wrapper.find("input").exists()).toBe(false);
  });

  it("renders label when prop is provided", () => {
    wrapper = mount(OInput, { props: { label: "Username" } });
    expect(wrapper.find("label").text()).toBe("Username");
  });

  it("emits update:modelValue on input", async () => {
    wrapper = mount(OInput, { props: { modelValue: "" } });
    await wrapper.find("input").setValue("hello");
    const emitted = wrapper.emitted("update:modelValue");
    expect(emitted).toBeTruthy();
    expect(emitted![0][0]).toBe("hello");
  });

  it("shows error message when provided", () => {
    wrapper = mount(OInput, { props: { error: true, errorMessage: "Required field" } });
    expect(wrapper.text()).toContain("Required field");
  });

  it("points aria-describedby at the error message so it is announced", () => {
    wrapper = mount(OInput, { props: { error: true, errorMessage: "Required field" } });
    const input = wrapper.find("input");
    const describedBy = input.attributes("aria-describedby");
    expect(describedBy).toBeTruthy();
    expect(input.attributes("aria-invalid")).toBe("true");
    // The referenced node must actually exist and carry the message —
    // a dangling aria-describedby announces nothing.
    const target = wrapper.find(`#${describedBy}`);
    expect(target.exists()).toBe(true);
    expect(target.text()).toContain("Required field");
  });

  it("sets no aria-describedby when there is no error to describe", () => {
    wrapper = mount(OInput, { props: { errorMessage: "Required field" } });
    expect(wrapper.find("input").attributes("aria-describedby")).toBeUndefined();
  });

  it("sets no dangling aria-describedby when the message is rendered elsewhere", () => {
    // `error` with no `errorMessage` yields " " — OFormInput's #error slot owns
    // the text, so this component renders no message node to point at.
    wrapper = mount(OInput, { props: { error: true } });
    expect(wrapper.find("input").attributes("aria-describedby")).toBeUndefined();
    expect(wrapper.find("input").attributes("aria-invalid")).toBe("true");
  });

  it("describes the textarea variant too", () => {
    wrapper = mount(OInput, {
      props: { type: "textarea", error: true, errorMessage: "Too long" },
    });
    const ta = wrapper.find("textarea");
    expect(ta.attributes("aria-invalid")).toBe("true");
    const describedBy = ta.attributes("aria-describedby");
    expect(describedBy).toBeTruthy();
    expect(wrapper.find(`#${describedBy}`).text()).toContain("Too long");
  });

  it("shows helpText when provided", () => {
    wrapper = mount(OInput, { props: { helpText: "Enter your name" } });
    expect(wrapper.text()).toContain("Enter your name");
  });

  it("shows clear button when clearable and value is non-empty", () => {
    wrapper = mount(OInput, {
      props: { clearable: true, modelValue: "hello" },
    });
    expect(wrapper.find('button[aria-label="Clear"]').exists()).toBe(true);
  });

  it("does not show clear button when value is empty", () => {
    wrapper = mount(OInput, { props: { clearable: true, modelValue: "" } });
    expect(wrapper.find('button[aria-label="Clear"]').exists()).toBe(false);
  });

  it("emits clear event when clear button is clicked", async () => {
    wrapper = mount(OInput, {
      props: { clearable: true, modelValue: "hello" },
    });
    await wrapper.find('button[aria-label="Clear"]').trigger("click");
    expect(wrapper.emitted("clear")).toBeTruthy();
    expect(wrapper.emitted("update:modelValue")![0][0]).toBe("");
  });

  it("is disabled when disabled prop is true", () => {
    wrapper = mount(OInput, { props: { disabled: true } });
    expect(wrapper.find("input").attributes("disabled")).toBeDefined();
  });

  it("shows counter when maxlength is set", () => {
    wrapper = mount(OInput, {
      props: { maxlength: 20, modelValue: "hello" },
    });
    expect(wrapper.text()).toContain("5/20");
  });

  it("emits debounced update when debounce is set", async () => {
    vi.useFakeTimers();

    wrapper = mount(OInput, {
      props: { modelValue: "", debounce: 200 },
    });

    await wrapper.find("input").setValue("hello");
    expect(wrapper.emitted("update:modelValue")).toBeFalsy();

    vi.advanceTimersByTime(200);
    expect(wrapper.emitted("update:modelValue")?.[0]?.[0]).toBe("hello");

    vi.useRealTimers();
  });

  it("applies model number modifier on emit", async () => {
    wrapper = mount(OInput, {
      props: {
        modelValue: "",
        modelModifiers: { number: true },
      },
    });

    await wrapper.find("input").setValue("42");
    expect(wrapper.emitted("update:modelValue")?.[0]?.[0]).toBe(42);
  });

  it("formats time mask before emitting value", async () => {
    wrapper = mount(OInput, {
      props: {
        modelValue: "",
        mask: "time",
      },
    });

    await wrapper.find("input").setValue("1234");
    expect(wrapper.emitted("update:modelValue")?.[0]?.[0]).toBe("12:34");
  });
});

describe("OInput — password reveal", () => {
  const mountPassword = (props: Record<string, unknown> = {}) =>
    mount(OInput, {
      props: { type: "password", modelValue: "hunter2", revealable: true, ...props },
      attrs: { "data-test": "secret" },
    });

  it("offers no toggle unless asked for", () => {
    const wrapper = mount(OInput, { props: { type: "password", modelValue: "x" } });
    expect(wrapper.find("[aria-pressed]").exists()).toBe(false);
  });

  it("offers no toggle on a field that is not masked to begin with", () => {
    const wrapper = mount(OInput, {
      props: { type: "text", modelValue: "x", revealable: true },
    });
    expect(wrapper.find("[aria-pressed]").exists()).toBe(false);
  });

  it("swaps the rendered type without changing what the field IS", async () => {
    const wrapper = mountPassword();
    const field = () => wrapper.get('[data-test="secret-field"]');
    expect(field().attributes("type")).toBe("password");

    await wrapper.get('[data-test="secret-reveal"]').trigger("click");
    expect(field().attributes("type")).toBe("text");
    // The prop is untouched, so the form still treats it as a password.
    expect(wrapper.props("type")).toBe("password");

    await wrapper.get('[data-test="secret-reveal"]').trigger("click");
    expect(field().attributes("type")).toBe("password");
  });

  it("announces which way it will move", async () => {
    const wrapper = mountPassword();
    const toggle = () => wrapper.get('[data-test="secret-reveal"]');
    expect(toggle().attributes("aria-pressed")).toBe("false");
    await toggle().trigger("click");
    expect(toggle().attributes("aria-pressed")).toBe("true");
  });

  // A type change must never leave a value on screen that the new type masks.
  it("re-masks when the field stops being a revealable password", async () => {
    const wrapper = mountPassword();
    await wrapper.get('[data-test="secret-reveal"]').trigger("click");
    expect(wrapper.get('[data-test="secret-field"]').attributes("type")).toBe("text");

    await wrapper.setProps({ revealable: false });
    expect(wrapper.get('[data-test="secret-field"]').attributes("type")).toBe("password");

    await wrapper.setProps({ revealable: true });
    expect(wrapper.get('[data-test="secret-field"]').attributes("type")).toBe("password");
  });

  it("stays out of the tab order, like the clear button", () => {
    expect(mountPassword().get('[data-test="secret-reveal"]').attributes("tabindex")).toBe("-1");
  });
});
