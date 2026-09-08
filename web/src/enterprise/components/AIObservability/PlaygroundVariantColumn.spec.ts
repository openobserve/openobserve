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

function mountColumn(
  variant: PlaygroundVariant,
  runDisabled = false,
  props: Record<string, unknown> = {},
) {
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
      ...props,
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

describe("PlaygroundVariantColumn — width", () => {
  // Every column always grows to fill whatever space the bench strip has,
  // down to a comfortable floor — the same rule at any column count, so
  // existing columns are free to narrow as more are added rather than
  // stranding leftover space behind an artificial cap. The strip's own
  // overflow-x-auto (PlaygroundPage.vue) is what takes over once the floor
  // is hit by enough columns.
  it("always grows to fill the row, with a floor and no ceiling", () => {
    // A stray columnCount prop, if the component still read one, would be
    // exactly what used to trigger the fixed/frozen width — passing it here
    // proves sizing no longer depends on sibling count at all.
    const wrapper = mountColumn(emptyVariant("provider-1", "model-1"), false, { columnCount: 4 });
    const classes = wrapper.get('[data-test="ai-playground-variant-A"]').classes();
    expect(classes).toContain("flex-1");
    expect(classes).toContain("min-w-93.5");
    expect(classes).not.toContain("shrink-0");
    expect(classes.some((c) => c.startsWith("max-w-"))).toBe(false);
  });
});
