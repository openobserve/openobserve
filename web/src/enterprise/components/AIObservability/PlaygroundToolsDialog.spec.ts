// Copyright 2026 OpenObserve Inc.
// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { mount } from "@vue/test-utils";

vi.mock("@/types/i18n", async () => {
  const actual = await vi.importActual<typeof import("@/types/i18n")>("@/types/i18n");
  return { ...actual, useI18nTyped: () => ({ t: (key: string) => key }) };
});

import PlaygroundToolsDialog from "./PlaygroundToolsDialog.vue";
import type { PlaygroundTool } from "@/enterprise/views/AIObservability/playgroundDraft";

const ODialog = {
  props: [
    "open",
    "size",
    "title",
    "primaryButtonLabel",
    "secondaryButtonLabel",
    "primaryButtonDisabled",
  ],
  emits: ["update:open", "click:primary", "click:secondary"],
  template:
    '<div class="o-dialog" :data-primary-disabled="primaryButtonDisabled">' +
    '<button class="primary" @click="$emit(\'click:primary\')" /><slot /></div>',
};
const OButton = {
  props: ["variant", "size", "iconLeft", "title"],
  emits: ["click"],
  template: "<button @click=\"$emit('click')\"><slot /></button>",
};
const OInput = {
  props: ["modelValue", "label", "placeholder", "size"],
  emits: ["update:modelValue"],
  template:
    '<input :value="modelValue" @input="$emit(\'update:modelValue\', $event.target.value)" />',
};
const OTextarea = {
  props: [
    "modelValue",
    "label",
    "helpText",
    "placeholder",
    "rows",
    "size",
    "fill",
    "error",
    "errorMessage",
  ],
  emits: ["update:modelValue"],
  template:
    '<textarea :data-error="error" :value="modelValue" @input="$emit(\'update:modelValue\', $event.target.value)" />',
};

/** `index` picks the tool being edited; `null` defines a new one. */
function mountDialog(tools: PlaygroundTool[], index: number | null = null) {
  return mount(PlaygroundToolsDialog, {
    props: { open: true, tools, index },
    global: { stubs: { ODialog, OButton, OInput, OTextarea } },
  });
}

const VALID: PlaygroundTool = {
  name: "lookup_order",
  description: "Find an order",
  parameters: '{ "type": "object" }',
};

describe("PlaygroundToolsDialog", () => {
  it("opens blank when a new tool is being defined", () => {
    const wrapper = mountDialog([VALID]);
    expect(
      (wrapper.find('[data-test="ai-playground-tool-name"]').element as HTMLInputElement).value,
    ).toBe("");
    // No list and no add button: the Tools button means "add one", the menu
    // beside it means "open that one".
    expect(wrapper.find('[data-test="ai-playground-tool-add"]').exists()).toBe(false);
    expect(wrapper.find('[data-test="ai-playground-tool-0"]').exists()).toBe(false);
  });

  it("loads the tool it was opened on", () => {
    const wrapper = mountDialog([VALID], 0);
    expect(
      (wrapper.find('[data-test="ai-playground-tool-name"]').element as HTMLInputElement).value,
    ).toBe("lookup_order");
    expect(
      (wrapper.find('[data-test="ai-playground-tool-description"]').element as HTMLInputElement)
        .value,
    ).toBe("Find an order");
  });

  it("blocks Apply while the parameter schema is unparseable", async () => {
    const wrapper = mountDialog([], null);
    await wrapper.find('[data-test="ai-playground-tool-parameters"]').setValue("{ not json");
    expect(wrapper.find(".o-dialog").attributes("data-primary-disabled")).toBe("true");
  });

  it("allows an empty schema — a tool may take no arguments", () => {
    const wrapper = mountDialog([], null);
    expect(wrapper.find(".o-dialog").attributes("data-primary-disabled")).toBe("false");
  });

  it("appends the new tool on apply, leaving the existing ones alone", async () => {
    const wrapper = mountDialog([VALID], null);
    await wrapper.find('[data-test="ai-playground-tool-name"]').setValue("refund_order");
    await wrapper.find(".primary").trigger("click");

    const applied = wrapper.emitted("apply")?.[0]?.[0] as PlaygroundTool[];
    expect(applied.map((tool) => tool.name)).toEqual(["lookup_order", "refund_order"]);
  });

  it("drops an unnamed tool — one that cannot be called is not a tool", async () => {
    const wrapper = mountDialog([VALID], null);
    await wrapper.find('[data-test="ai-playground-tool-description"]').setValue("no name given");
    await wrapper.find(".primary").trigger("click");

    const applied = wrapper.emitted("apply")?.[0]?.[0] as PlaygroundTool[];
    expect(applied).toHaveLength(1);
    expect(applied[0].name).toBe("lookup_order");
  });

  it("edits a local copy, so the source tools are untouched until Apply", async () => {
    const source = [{ ...VALID }];
    const wrapper = mountDialog(source, 0);

    await wrapper.find('[data-test="ai-playground-tool-name"]').setValue("renamed");
    expect(source[0].name).toBe("lookup_order");

    await wrapper.find(".primary").trigger("click");
    const applied = wrapper.emitted("apply")?.[0]?.[0] as PlaygroundTool[];
    expect(applied[0].name).toBe("renamed");
  });

  it("removes the tool it was opened on", async () => {
    const wrapper = mountDialog([VALID, { ...VALID, name: "refund_order" }], 0);
    await wrapper.find('[data-test="ai-playground-tool-remove"]').trigger("click");

    const applied = wrapper.emitted("apply")?.[0]?.[0] as PlaygroundTool[];
    expect(applied.map((tool) => tool.name)).toEqual(["refund_order"]);
  });

  it("offers Remove only for a tool that exists", () => {
    expect(
      mountDialog([VALID], null).find('[data-test="ai-playground-tool-remove"]').exists(),
    ).toBe(false);
    expect(mountDialog([VALID], 0).find('[data-test="ai-playground-tool-remove"]').exists()).toBe(
      true,
    );
  });

  it("closes on apply", async () => {
    const wrapper = mountDialog([VALID], 0);
    await wrapper.find(".primary").trigger("click");
    expect(wrapper.emitted("update:open")?.at(-1)).toEqual([false]);
  });
});
