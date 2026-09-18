// Copyright 2026 OpenObserve Inc.
// @vitest-environment jsdom
import { mount } from "@vue/test-utils";
import { describe, expect, it, vi } from "vitest";
import { emptyVariant } from "@/enterprise/views/AIObservability/playgroundDraft";
import PlaygroundMessageList from "./PlaygroundMessageList.vue";

vi.mock("@/types/i18n", async () => {
  const actual = await vi.importActual<typeof import("@/types/i18n")>("@/types/i18n");
  return {
    ...actual,
    useI18nTyped: () => ({ t: (key: string) => key }),
  };
});

const OTextarea = {
  name: "OTextarea",
  props: ["modelValue", "width"],
  template: '<textarea :data-width="width" />',
};

describe("PlaygroundMessageList", () => {
  it("places the tool result below the tool metadata", () => {
    const variant = emptyVariant("provider-1", "model-1");
    variant.tools = [
      {
        name: "lookup_order",
        description: "Find an order",
        parameters: '{"type":"object"}',
      },
    ];
    variant.messages.push({
      id: "tool-result-1",
      role: "tool",
      content: "asdf",
      toolName: "lookup_order",
      toolCallId: "call-1",
      toolArguments: '{"order_id":"123"}',
    });

    const wrapper = mount(PlaygroundMessageList, {
      props: { variant, varNames: [] },
      global: {
        stubs: {
          OTextarea,
          OButton: true,
          ODropdown: true,
          ODropdownItem: true,
          OIcon: true,
          OSelect: true,
          OTag: true,
          OTooltip: true,
        },
      },
    });

    const editor = wrapper.get("[data-test='ai-playground-message-tool-editor-tool-result-1']");
    const metadata = editor.get("[data-test='ai-playground-message-tool-metadata-tool-result-1']");
    const argumentsField = editor.get(
      "[data-test='ai-playground-message-tool-arguments-tool-result-1']",
    );
    const resultField = editor.get("[data-test='ai-playground-message-input-tool-result-1']");

    expect(argumentsField.attributes("data-width")).toBe("full");
    expect(metadata.element.contains(argumentsField.element)).toBe(true);
    expect(metadata.element.contains(resultField.element)).toBe(false);
  });
});

describe("PlaygroundMessageList — variable value popover", () => {
  // The real OTextarea, not the lightweight stub above: the popover hinges on
  // genuine caret position (selectionStart) and click/keyup bubbling through
  // OTextarea's own DOM, neither of which a stub textarea can exercise.
  const realTextareaStubs = {
    OButton: true,
    ODropdown: true,
    ODropdownItem: true,
    OIcon: true,
    OSelect: true,
    OTag: true,
    OTooltip: true,
  };

  function mountWithMessage(content: string, vars: Record<string, string>) {
    const variant = emptyVariant("provider-1", "model-1");
    variant.messages = [{ id: "user-1", role: "user", content }];
    const wrapper = mount(PlaygroundMessageList, {
      props: { variant, varNames: Object.keys(vars), vars },
      global: { stubs: realTextareaStubs },
      attachTo: document.body,
    });
    // OTextarea forwards its own data-test to the wrapper and appends
    // "-field" for the actual native <textarea> — the one real selection and
    // click/keyup happen on.
    const field = wrapper.get('[data-test="ai-playground-message-input-user-1-field"]');
    return { wrapper, field };
  }

  async function placeCaret(field: ReturnType<typeof mountWithMessage>["field"], at: number) {
    const el = field.element as HTMLTextAreaElement;
    el.focus();
    el.setSelectionRange(at, at);
    await field.trigger("click");
  }

  const popover = '[data-test="ai-playground-var-value-user-1"]';
  // Matches HOVER_DELAY_MS in PlaygroundMessageList.vue — see the comment there
  // for why the popover waits rather than showing on every caret move.
  const HOVER_DELAY_MS = 300;

  it("does not show the value immediately — only after the hover delay", async () => {
    vi.useFakeTimers();
    const { wrapper, field } = mountWithMessage("Hello {{input}}!", {
      input: "What is p99 latency?",
    });
    await placeCaret(field, 10); // inside {{input}}
    expect(wrapper.find(popover).exists()).toBe(false);

    vi.advanceTimersByTime(HOVER_DELAY_MS);
    await wrapper.vm.$nextTick();
    expect(wrapper.get(popover).text()).toContain("What is p99 latency?");

    wrapper.unmount();
    vi.useRealTimers();
  });

  it("shows nothing while the caret sits outside any token", async () => {
    const { wrapper, field } = mountWithMessage("Hello {{input}}!", { input: "value" });
    await placeCaret(field, 2); // inside "Hello"
    expect(wrapper.find(popover).exists()).toBe(false);
  });

  it("shows nothing for a token that isn't a known variable, even after the delay", async () => {
    vi.useFakeTimers();
    const { wrapper, field } = mountWithMessage("Hello {{typo}}!", {});
    await placeCaret(field, 10);
    vi.advanceTimersByTime(HOVER_DELAY_MS);
    await wrapper.vm.$nextTick();
    expect(wrapper.find(popover).exists()).toBe(false);

    wrapper.unmount();
    vi.useRealTimers();
  });

  it("clears once focus leaves the field", async () => {
    vi.useFakeTimers();
    const { wrapper, field } = mountWithMessage("{{input}}", { input: "value" });
    await placeCaret(field, 3);
    vi.advanceTimersByTime(HOVER_DELAY_MS);
    await wrapper.vm.$nextTick();
    expect(wrapper.find(popover).exists()).toBe(true);

    await field.trigger("blur");
    expect(wrapper.find(popover).exists()).toBe(false);

    wrapper.unmount();
    vi.useRealTimers();
  });

  it("cancels a pending show if the caret leaves the token before the delay elapses", async () => {
    vi.useFakeTimers();
    const { wrapper, field } = mountWithMessage("Hello {{input}}!", { input: "value" });
    await placeCaret(field, 10); // inside {{input}} — schedules the popover
    await placeCaret(field, 2); // back to "Hello" before it fires

    vi.advanceTimersByTime(HOVER_DELAY_MS);
    await wrapper.vm.$nextTick();
    expect(wrapper.find(popover).exists()).toBe(false);

    wrapper.unmount();
    vi.useRealTimers();
  });

  it("clears its pending timer on unmount", async () => {
    vi.useFakeTimers();
    const clearTimeoutSpy = vi.spyOn(globalThis, "clearTimeout");
    const { wrapper, field } = mountWithMessage("{{input}}", { input: "value" });
    await placeCaret(field, 3); // schedules the popover, never lets it fire

    wrapper.unmount();
    expect(clearTimeoutSpy).toHaveBeenCalled();

    clearTimeoutSpy.mockRestore();
    vi.useRealTimers();
  });
});
