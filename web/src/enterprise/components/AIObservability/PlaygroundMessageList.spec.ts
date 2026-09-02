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
  it("uses the textarea width contract for tool arguments", () => {
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

    expect(
      wrapper
        .get("[data-test='ai-playground-message-tool-arguments-tool-result-1']")
        .attributes("data-width"),
    ).toBe("xs");
  });
});
