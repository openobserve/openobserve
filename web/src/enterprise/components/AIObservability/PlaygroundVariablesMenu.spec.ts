// @vitest-environment jsdom
// Copyright 2026 OpenObserve Inc.

import { describe, expect, it, vi } from "vitest";
import { mount } from "@vue/test-utils";
import PlaygroundVariablesMenu from "./PlaygroundVariablesMenu.vue";

vi.mock("@/types/i18n", async () => {
  const actual = await vi.importActual<typeof import("@/types/i18n")>("@/types/i18n");
  return { ...actual, useI18nTyped: () => ({ t: (key: string) => key }) };
});

const stubs = {
  OButton: {
    emits: ["click"],
    template: `<button v-bind="$attrs" @click="$emit('click')"><slot /></button>`,
  },
  OTag: { props: ["variant", "size"], template: `<span><slot /></span>` },
  ODropdown: {
    props: ["open"],
    emits: ["update:open"],
    // A real toggle, not a static stub: the "seen" behaviour hinges on the
    // dropdown's own open transition, so the test has to be able to drive it.
    template: `<div><span data-test="trigger-slot" @click="$emit('update:open', !open)"><slot name="trigger" /></span><slot v-if="open" /></div>`,
  },
};

function mountMenu(props: Record<string, unknown> = {}) {
  return mount(PlaygroundVariablesMenu, {
    props: { varNames: [], vars: {}, used: [], ...props },
    global: { stubs },
  });
}

const newTag = '[data-test="ai-playground-variables-new-tag"]';
const trigger = '[data-test="ai-playground-variables-trigger"]';

async function openAndCloseDropdown(wrapper: ReturnType<typeof mountMenu>) {
  await wrapper.get('[data-test="trigger-slot"]').trigger("click");
  await wrapper.get('[data-test="trigger-slot"]').trigger("click");
}

describe("PlaygroundVariablesMenu — New tag", () => {
  it("shows New for a variable with a value that has never been opened", () => {
    const wrapper = mountMenu({ varNames: ["input"], vars: { input: "hi" } });
    expect(wrapper.find(newTag).exists()).toBe(true);
  });

  it("shows nothing for a declared variable with no value yet", () => {
    const wrapper = mountMenu({ varNames: ["input"], vars: { input: "" } });
    expect(wrapper.find(newTag).exists()).toBe(false);
  });

  // The whole point: once the dropdown has been opened, the value has been
  // seen, so the badge that exists to earn that first glance has nothing
  // left to do.
  it("hides New once the dropdown has been opened", async () => {
    const wrapper = mountMenu({ varNames: ["input"], vars: { input: "hi" } });
    await openAndCloseDropdown(wrapper);
    expect(wrapper.find(newTag).exists()).toBe(false);
  });

  // A variable already referenced in a message can still receive a fresh
  // sampled value — "used" and "seen" are independent, so New tracks only
  // whether THIS value has been looked at.
  it("shows New for an already-used variable whose value just changed", async () => {
    const wrapper = mountMenu({ varNames: ["input"], vars: { input: "hi" }, used: ["input"] });
    await openAndCloseDropdown(wrapper);
    expect(wrapper.find(newTag).exists()).toBe(false);

    await wrapper.setProps({ vars: { input: "a different question" } });
    expect(wrapper.find(newTag).exists()).toBe(true);
  });

  // Sampling can land while the user is looking anywhere on the page — the
  // flash has to be a passive visual cue, never a focus grab that yanks the
  // cursor out from under something they're mid-typing.
  it("flashes the trigger, then settles", async () => {
    vi.useFakeTimers();
    const wrapper = mountMenu();
    const triggerEl = () => wrapper.get(trigger);

    expect(triggerEl().attributes("data-flashing")).toBeUndefined();

    (wrapper.vm as unknown as { flash: () => void }).flash();
    await wrapper.vm.$nextTick();
    expect(triggerEl().attributes("data-flashing")).toBe("true");
    expect(triggerEl().classes()).toContain("ring-accent");

    vi.advanceTimersByTime(1200);
    await wrapper.vm.$nextTick();
    expect(triggerEl().attributes("data-flashing")).toBeUndefined();
    expect(triggerEl().classes()).toContain("ring-transparent");

    wrapper.unmount();
    vi.useRealTimers();
  });
});
