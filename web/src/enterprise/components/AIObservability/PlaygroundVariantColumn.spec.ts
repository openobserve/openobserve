// Copyright 2026 OpenObserve Inc.
// @vitest-environment jsdom
import { mount } from "@vue/test-utils";
import { describe, expect, it, vi } from "vitest";
import {
  emptyVariant,
  idleCell,
  type PlaygroundVariant,
} from "@/enterprise/views/AIObservability/playgroundDraft";
import PlaygroundVariantColumn from "./PlaygroundVariantColumn.vue";

vi.mock("@/types/i18n", async () => {
  const actual = await vi.importActual<typeof import("@/types/i18n")>("@/types/i18n");
  return {
    ...actual,
    useI18nTyped: () => ({ t: (key: string) => key }),
  };
});

const OButton = {
  props: ["disabled", "title", "size", "iconLeft"],
  emits: ["click"],
  template:
    '<button :disabled="disabled" :title="title" @click="$emit(\'click\')"><slot /></button>',
};

const OSplitter = {
  template: '<div><slot name="before" /><slot name="after" /></div>',
};

function mountColumn(variant: PlaygroundVariant, runDisabled = false) {
  return mount(PlaygroundVariantColumn, {
    props: {
      variant,
      label: "A",
      cell: {
        ...idleCell(),
        status: "done",
        toolCall: {
          id: "call_1",
          name: "lookup_order",
          arguments: '{"order_id":"123"}',
        },
      },
      providers: [],
      varNames: [],
      vars: {},
      runDisabled,
    },
    global: {
      stubs: {
        OButton,
        OSplitter,
        PlaygroundVariantHeader: true,
        PlaygroundVariantConfig: true,
        PlaygroundOutputCell: true,
      },
    },
  });
}

describe("PlaygroundVariantColumn", () => {
  it("shows a named action for adding a returned tool call to messages", async () => {
    const wrapper = mountColumn(emptyVariant("provider-1", "model-1"));
    const add = wrapper.get('[data-test="ai-playground-output-add-to-messages-A"]');

    expect(add.text()).toBe("aiObservability.playground.toolCallAddToMessages");
    await add.trigger("click");
    expect(wrapper.emitted("add-to-messages")).toHaveLength(1);
  });

  it("explains that Run needs the tool result", () => {
    const variant = emptyVariant("provider-1", "model-1");
    variant.messages.push({
      id: "tool-result-1",
      role: "tool",
      content: "",
      toolName: "lookup_order",
      toolCallId: "call_1",
      toolArguments: '{"order_id":"123"}',
    });

    const wrapper = mountColumn(variant, true);

    expect(wrapper.get('[data-test="ai-playground-run-disabled-reason-A"]').text()).toBe(
      "aiObservability.playground.toolResultRequired",
    );
    expect(
      wrapper.get('[data-test="ai-playground-variant-submit-A"]').attributes("disabled"),
    ).toBeDefined();
  });
});
