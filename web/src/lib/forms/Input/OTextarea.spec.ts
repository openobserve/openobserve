// Copyright 2026 OpenObserve Inc.

import { describe, it, expect, afterEach } from "vitest";
import { mount, VueWrapper } from "@vue/test-utils";
import OTextarea from "./OTextarea.vue";

describe("OTextarea", () => {
  let wrapper: VueWrapper;

  afterEach(() => {
    wrapper?.unmount();
  });

  it("renders without errors", () => {
    wrapper = mount(OTextarea);
    expect(wrapper.exists()).toBe(true);
  });

  it("renders a textarea element", () => {
    wrapper = mount(OTextarea);
    expect(wrapper.find("textarea").exists()).toBe(true);
  });

  it("renders label when prop is provided", () => {
    wrapper = mount(OTextarea, { props: { label: "Description" } });
    expect(wrapper.find("label").text()).toBe("Description");
  });

  it("emits update:modelValue on input", async () => {
    wrapper = mount(OTextarea, { props: { modelValue: "" } });
    await wrapper.find("textarea").setValue("hello world");
    const emitted = wrapper.emitted("update:modelValue");
    expect(emitted).toBeTruthy();
    expect(emitted![0][0]).toBe("hello world");
  });

  it("shows error message when provided", () => {
    wrapper = mount(OTextarea, {
      props: { error: true, errorMessage: "Required field" },
    });
    expect(wrapper.text()).toContain("Required field");
  });

  it("shows helpText when provided", () => {
    wrapper = mount(OTextarea, {
      props: { helpText: "Enter a description" },
    });
    expect(wrapper.text()).toContain("Enter a description");
  });

  it("is disabled when disabled prop is true", () => {
    wrapper = mount(OTextarea, { props: { disabled: true } });
    expect(wrapper.find("textarea").attributes("disabled")).toBeDefined();
  });

  it("shows counter when maxlength is set", () => {
    wrapper = mount(OTextarea, {
      props: { maxlength: 200, modelValue: "hello" },
    });
    expect(wrapper.text()).toContain("5/200");
  });

  it("puts inputAttrs on the textarea itself and exposes focus and the element", async () => {
    wrapper = mount(OTextarea, {
      props: { inputAttrs: { "aria-label": "Message", "data-x": "1" } },
      attrs: { "data-test": "box" },
      attachTo: document.body,
    });
    const textarea = wrapper.get("textarea");
    expect(textarea.attributes("aria-label")).toBe("Message");
    expect(textarea.attributes("data-x")).toBe("1");
    expect(wrapper.get('[data-test="box"]').attributes("aria-label")).toBeUndefined();
    const vm = wrapper.vm as unknown as { focus(): void; textarea: HTMLTextAreaElement | null };
    vm.focus();
    expect(document.activeElement).toBe(textarea.element);
    expect(vm.textarea).toBe(textarea.element);
  });

  it("gives an informative placeholder secondary-text contrast with placeholderTone strong", () => {
    wrapper = mount(OTextarea, {
      props: { placeholderTone: "strong", placeholder: "Ask" as never },
    });
    expect(wrapper.get("textarea").classes()).toContain("placeholder:text-text-secondary");
    wrapper = mount(OTextarea, { props: { placeholder: "Ask" as never } });
    expect(wrapper.get("textarea").classes()).toContain("placeholder:text-input-placeholder");
  });
});
