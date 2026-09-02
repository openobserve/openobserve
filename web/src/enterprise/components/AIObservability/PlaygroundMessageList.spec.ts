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
