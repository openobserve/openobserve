// Copyright 2026 OpenObserve Inc.

import { describe, it, expect, afterEach, vi } from "vitest";
import { flushPromises, mount, VueWrapper } from "@vue/test-utils";
import OInlineEdit from "./OInlineEdit.vue";

const mountInlineEdit = (props: Record<string, unknown> = {}) =>
  mount(OInlineEdit, {
    props: { modelValue: "Panel one", "data-test": "name", ...props },
    global: { stubs: { OIcon: true } },
  });

const trigger = (wrapper: ReturnType<typeof mountInlineEdit>) =>
  wrapper.find('[data-test="name-trigger"]');
const input = (wrapper: ReturnType<typeof mountInlineEdit>) =>
  wrapper.find('[data-test="name-input"]');

describe("OInlineEdit", () => {
  it("renders the value as text with no input until it is opened", () => {
    const wrapper = mountInlineEdit();

    expect(wrapper.find('[data-test="name-value"]').text()).toBe("Panel one");
    expect(input(wrapper).exists()).toBe(false);
  });

  it("falls back to the placeholder when the value is empty", () => {
    const wrapper = mountInlineEdit({ modelValue: "", placeholder: "Untitled panel" });

    expect(wrapper.find('[data-test="name-value"]').text()).toBe("Untitled panel");
  });

  it("swaps to an input seeded with the current value on click", async () => {
    const wrapper = mountInlineEdit();

    await trigger(wrapper).trigger("click");

    expect(input(wrapper).exists()).toBe(true);
    expect((input(wrapper).element as HTMLInputElement).value).toBe("Panel one");
    expect(trigger(wrapper).exists()).toBe(false);
  });

  it("emits every keystroke so a consumer can detect the user taking over", async () => {
    const wrapper = mountInlineEdit();
    await trigger(wrapper).trigger("click");

    await input(wrapper).setValue("Panel two");

    expect(wrapper.emitted("update:modelValue")).toEqual([["Panel two"]]);
  });

  it("commits the trimmed value and closes on Enter", async () => {
    const wrapper = mountInlineEdit();
    await trigger(wrapper).trigger("click");
    await input(wrapper).setValue("  Panel two  ");

    await input(wrapper).trigger("keydown.enter");

    expect(wrapper.emitted("commit")).toEqual([["Panel two"]]);
    expect(input(wrapper).exists()).toBe(false);
  });

  it("commits on blur, so clicking Save straight from the input keeps the text", async () => {
    const wrapper = mountInlineEdit();
    await trigger(wrapper).trigger("click");
    await input(wrapper).setValue("Panel two");

    await input(wrapper).trigger("blur");

    expect(wrapper.emitted("commit")).toEqual([["Panel two"]]);
  });

  it("restores the pre-edit value on Escape", async () => {
    const wrapper = mountInlineEdit();
    await trigger(wrapper).trigger("click");
    await input(wrapper).setValue("Panel two");

    await input(wrapper).trigger("keydown.esc");

    // Last emission puts the original value back; no commit was made.
    expect(wrapper.emitted("update:modelValue")?.at(-1)).toEqual(["Panel one"]);
    expect(wrapper.emitted("commit")).toBeUndefined();
    expect(wrapper.emitted("cancel")).toHaveLength(1);
  });

  it("renders the error message as an alert without hiding the value", () => {
    const wrapper = mountInlineEdit({
      modelValue: "",
      error: true,
      errorMessage: "Name is required",
    });

    const message = wrapper.find('[data-test="name-error"]');
    expect(message.text()).toBe("Name is required");
    expect(message.attributes("role")).toBe("alert");
  });

  it("offers no edit affordance when readonly", () => {
    const wrapper = mountInlineEdit({ readonly: true });

    expect(trigger(wrapper).exists()).toBe(false);
    expect(wrapper.find('[data-test="name-value"]').text()).toBe("Panel one");
  });

  it("opens the editor when focused imperatively — display mode has no input to focus", async () => {
    const wrapper = mountInlineEdit();

    (wrapper.vm as unknown as { focus: () => void }).focus();
    await wrapper.vm.$nextTick();

    expect(input(wrapper).exists()).toBe(true);
  });

  it("exposes the display trigger to focus-the-first-error walkers", () => {
    const wrapper = mountInlineEdit();

    expect(wrapper.find("[data-inline-edit-trigger]").exists()).toBe(true);
  });

  // The title replaced a boxed input that sat inside the page's <form>: Enter
  // saved, and Tab walked on to the header's action buttons. Both have to keep
  // working now that the field unmounts itself when it closes.
  describe("keyboard", () => {
    let wrapper: VueWrapper;

    afterEach(() => {
      wrapper?.unmount();
    });

    const mountAttached = () =>
      mount(OInlineEdit, {
        attachTo: document.body,
        props: { modelValue: "Panel one", "data-test": "name" },
        global: { stubs: { OIcon: true } },
      });

    it("should not swallow Enter, so nothing else listening for it is blocked", async () => {
      wrapper = mountAttached();
      await wrapper.find('[data-test="name-trigger"]').trigger("click");

      const enter = new KeyboardEvent("keydown", {
        key: "Enter",
        bubbles: true,
        cancelable: true,
      });
      wrapper.find('[data-test="name-input"]').element.dispatchEvent(enter);
      await flushPromises();

      expect(enter.defaultPrevented).toBe(false);
      expect(wrapper.emitted("commit")).toEqual([["Panel one"]]);
    });

    it("should submit the owning form on Enter, so the header's Save is still reachable", async () => {
      const onSubmit = vi.fn((event: Event) => event.preventDefault());
      const Host = {
        components: { OInlineEdit },
        setup: () => ({ onSubmit }),
        template: `
          <form @submit="onSubmit">
            <OInlineEdit model-value="Panel one" data-test="name" />
            <button type="submit">Save</button>
          </form>`,
      };
      wrapper = mount(Host, { attachTo: document.body, global: { stubs: { OIcon: true } } });
      await wrapper.find('[data-test="name-trigger"]').trigger("click");

      await wrapper.find('[data-test="name-input"]').trigger("keydown.enter");
      await flushPromises();

      expect(onSubmit).toHaveBeenCalledTimes(1);
    });

    it("should submit nothing on Enter when the title has no form around it", async () => {
      wrapper = mountAttached();
      await wrapper.find('[data-test="name-trigger"]').trigger("click");

      // Would throw if the component reached for a form that isn't there.
      await wrapper.find('[data-test="name-input"]').trigger("keydown.enter");
      await flushPromises();

      expect(wrapper.emitted("commit")).toEqual([["Panel one"]]);
    });

    it("should return focus to the trigger on Enter, so Tab continues to the header actions", async () => {
      wrapper = mountAttached();
      await wrapper.find('[data-test="name-trigger"]').trigger("click");

      await wrapper.find('[data-test="name-input"]').trigger("keydown.enter");
      await flushPromises();

      expect(document.activeElement).toBe(wrapper.find('[data-test="name-trigger"]').element);
    });

    it("should return focus to the trigger on Escape", async () => {
      wrapper = mountAttached();
      await wrapper.find('[data-test="name-trigger"]').trigger("click");

      await wrapper.find('[data-test="name-input"]').trigger("keydown.esc");
      await flushPromises();

      expect(document.activeElement).toBe(wrapper.find('[data-test="name-trigger"]').element);
    });

    it("should leave focus alone when the editor closes because focus went elsewhere", async () => {
      wrapper = mountAttached();
      const outside = document.createElement("button");
      document.body.appendChild(outside);
      await wrapper.find('[data-test="name-trigger"]').trigger("click");

      outside.focus();
      await wrapper.find('[data-test="name-input"]').trigger("blur");
      await flushPromises();

      expect(document.activeElement).toBe(outside);
      outside.remove();
    });
  });

  it("shows the trail slot in display mode only", async () => {
    const wrapper = mount(OInlineEdit, {
      props: { modelValue: "Panel one", "data-test": "name" },
      slots: { trail: '<span data-test="auto-badge">Auto</span>' },
      global: { stubs: { OIcon: true } },
    });

    expect(wrapper.find('[data-test="auto-badge"]').exists()).toBe(true);

    await trigger(wrapper).trigger("click");

    expect(wrapper.find('[data-test="auto-badge"]').exists()).toBe(false);
  });
});
