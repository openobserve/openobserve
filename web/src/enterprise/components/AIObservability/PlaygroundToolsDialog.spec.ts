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

function mountDialog(tools: PlaygroundTool[]) {
  return mount(PlaygroundToolsDialog, {
    props: { open: true, tools },
    global: { stubs: { ODialog, OButton, OInput, OTextarea } },
  });
}

const VALID: PlaygroundTool = {
  name: "lookup_order",
  description: "Find an order",
  parameters: '{ "type": "object" }',
};

describe("PlaygroundToolsDialog", () => {
  it("shows an empty state before any tool is defined", () => {
    expect(mountDialog([]).text()).toContain("aiObservability.playground.toolsEmpty");
  });

  it("loads the current tools when it opens", () => {
    const wrapper = mountDialog([VALID]);
    expect(wrapper.find('[data-test="ai-playground-tool-0"]').exists()).toBe(true);
  });

  it("blocks Apply while any parameter schema is unparseable", async () => {
    const wrapper = mountDialog([{ ...VALID, parameters: "{ not json" }]);
    expect(wrapper.find(".o-dialog").attributes("data-primary-disabled")).toBe("true");
  });

  it("allows empty parameters — a tool may take none", () => {
    const wrapper = mountDialog([{ ...VALID, parameters: "" }]);
    expect(wrapper.find(".o-dialog").attributes("data-primary-disabled")).toBe("false");
  });

  it("drops unnamed tools on apply — a tool that cannot be called is not a tool", async () => {
    const wrapper = mountDialog([VALID, { name: "  ", description: "", parameters: "" }]);
    await wrapper.find(".o-dialog .primary").trigger("click");

    const applied = wrapper.emitted("apply")?.[0]?.[0] as PlaygroundTool[];
    expect(applied).toHaveLength(1);
    expect(applied[0].name).toBe("lookup_order");
  });

  it("closes itself after applying", async () => {
    const wrapper = mountDialog([VALID]);
    await wrapper.find(".o-dialog .primary").trigger("click");
    expect(wrapper.emitted("update:open")).toEqual([[false]]);
  });

  it("edits a local copy, so the source tools are untouched until Apply", async () => {
    const source = [{ ...VALID }];
    const wrapper = mountDialog(source);

    await wrapper.find('[data-test="ai-playground-tool-name-0"]').setValue("renamed");

    expect(source[0].name).toBe("lookup_order");
    expect(wrapper.emitted("apply")).toBeUndefined();
  });

  it("adds and removes rows", async () => {
    const wrapper = mountDialog([VALID]);

    await wrapper.find('[data-test="ai-playground-tool-add"]').trigger("click");
    expect(wrapper.find('[data-test="ai-playground-tool-1"]').exists()).toBe(true);

    await wrapper.find('[data-test="ai-playground-tool-remove-0"]').trigger("click");
    expect(wrapper.find('[data-test="ai-playground-tool-1"]').exists()).toBe(false);
  });
});
