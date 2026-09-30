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

const OTemplateTextarea = {
  name: "OTemplateTextarea",
  props: ["modelValue", "suggestions", "values"],
  template: "<textarea data-template-textarea />",
};

const stubs = {
  OTextarea,
  OTemplateTextarea,
  OButton: true,
  ODropdown: true,
  ODropdownItem: true,
  OIcon: true,
  OSelect: true,
  OTag: true,
  OTooltip: true,
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
      props: { variant, varNames: [], vars: {} },
      global: { stubs },
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

  it("hands each message field the declared variables, minus expected_output, and their values", () => {
    const variant = emptyVariant("provider-1", "model-1");
    variant.messages = [{ id: "user-1", role: "user", content: "" }];
    const vars = { input: "What is p99?", expected_output: "the answer" };

    const wrapper = mount(PlaygroundMessageList, {
      props: { variant, varNames: Object.keys(vars), vars },
      global: { stubs },
    });

    const field = wrapper.getComponent<typeof OTemplateTextarea>(
      '[data-test="ai-playground-message-input-user-1"]',
    );
    expect(field.vm.$options.name).toBe("OTemplateTextarea");
    expect(field.props("suggestions")).toEqual([{ name: "input" }]);
    expect(field.props("values")).toEqual(vars);
  });
});
