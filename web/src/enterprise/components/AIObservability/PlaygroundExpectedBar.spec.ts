// @vitest-environment jsdom
// Copyright 2026 OpenObserve Inc.

import { describe, expect, it, vi } from "vitest";
import { mount } from "@vue/test-utils";
import PlaygroundExpectedBar from "./PlaygroundExpectedBar.vue";

vi.mock("@/types/i18n", async () => {
  const actual = await vi.importActual<typeof import("@/types/i18n")>("@/types/i18n");
  return { ...actual, useI18nTyped: () => ({ t: (key: string) => key }) };
});

const stubs = {
  OButton: {
    emits: ["click"],
    template: `<button v-bind="$attrs" @click="$emit('click')"><slot /></button>`,
  },
  OTextarea: {
    props: ["modelValue"],
    emits: ["update:modelValue"],
    template: `<textarea :value="modelValue" @input="$emit('update:modelValue', $event.target.value)" />`,
  },
};

function mountBar(props: Record<string, unknown> = {}) {
  return mount(PlaygroundExpectedBar, {
    props: { expected: null, ...props },
    global: { stubs },
    attachTo: document.body,
  });
}

const removeBtn = '[data-test="ai-playground-remove-expected"]';

describe("PlaygroundExpectedBar", () => {
  it("edits the golden answer", async () => {
    const wrapper = mountBar({ expected: "old" });
    await wrapper.get("textarea").setValue("new");
    expect(wrapper.emitted("set-expected")?.[0]).toEqual(["new"]);
  });

  it("clears back to nothing", async () => {
    const wrapper = mountBar({ expected: "old" });
    await wrapper.get(removeBtn).trigger("click");
    expect(wrapper.emitted("set-expected")?.[0]).toEqual([null]);
  });

  // Clearing it while a scorer depends on it would silently re-break the
  // scoring the user just fixed.
  it("hides clear while a scorer requires one", () => {
    expect(mountBar({ expected: "x", required: true }).find(removeBtn).exists()).toBe(false);
  });

  it("offers no clear when there is nothing to clear", () => {
    expect(mountBar({ expected: null }).find(removeBtn).exists()).toBe(false);
  });

  // The Score panel's notice calls this, so the warning and its fix are one
  // gesture rather than two ends of the page.
  it("exposes a focus seam for the Score panel", async () => {
    const wrapper = mountBar({ required: true });
    (wrapper.vm as unknown as { focus: () => void }).focus();
    await wrapper.vm.$nextTick();
    expect(document.activeElement?.tagName.toLowerCase()).toBe("textarea");
    wrapper.unmount();
  });

  // A focus ring alone changes nothing the eye was looking at: the notice that
  // sends you here is at the opposite corner of the page.
  it("flashes the field, then settles", async () => {
    vi.useFakeTimers();
    const wrapper = mountBar({ required: true });
    const field = () => wrapper.get('[data-test="ai-playground-expected-field"]');

    expect(field().attributes("data-flashing")).toBeUndefined();

    (wrapper.vm as unknown as { focus: () => void }).focus();
    await wrapper.vm.$nextTick();
    expect(field().attributes("data-flashing")).toBe("true");
    expect(field().classes()).toContain("ring-accent");

    vi.advanceTimersByTime(1200);
    await wrapper.vm.$nextTick();
    expect(field().attributes("data-flashing")).toBeUndefined();
    expect(field().classes()).toContain("ring-transparent");

    wrapper.unmount();
    vi.useRealTimers();
  });

  // Asking twice must re-arm the flash rather than let the first timer end it
  // half a second into the second one.
  it("restarts the flash when asked again", async () => {
    vi.useFakeTimers();
    const wrapper = mountBar({ required: true });
    const vm = wrapper.vm as unknown as { focus: () => void };
    const field = () => wrapper.get('[data-test="ai-playground-expected-field"]');

    vm.focus();
    vi.advanceTimersByTime(1000);
    vm.focus();
    vi.advanceTimersByTime(1000);
    await wrapper.vm.$nextTick();
    expect(field().attributes("data-flashing")).toBe("true");

    wrapper.unmount();
    vi.useRealTimers();
  });
});
