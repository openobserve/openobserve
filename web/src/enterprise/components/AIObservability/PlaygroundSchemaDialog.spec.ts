// Copyright 2026 OpenObserve Inc.
// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { mount } from "@vue/test-utils";

vi.mock("@/types/i18n", async () => {
  const actual = await vi.importActual<typeof import("@/types/i18n")>("@/types/i18n");
  return { ...actual, useI18nTyped: () => ({ t: (key: string) => key }) };
});

import PlaygroundSchemaDialog from "./PlaygroundSchemaDialog.vue";

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
const OCheckbox = {
  props: ["modelValue", "label"],
  emits: ["update:modelValue"],
  template:
    '<input type="checkbox" :checked="modelValue" @change="$emit(\'update:modelValue\', $event.target.checked)" />',
};
const OTextarea = {
  props: ["modelValue", "rows", "size", "fill", "disabled", "error", "errorMessage", "helpText"],
  emits: ["update:modelValue"],
  template:
    '<textarea :data-disabled="disabled" :value="modelValue" @input="$emit(\'update:modelValue\', $event.target.value)" />',
};
const OBanner = {
  props: ["variant", "dataTest"],
  template: '<div :data-test="dataTest"><slot /></div>',
};

function mountDialog(props: { schema?: string | null; dropped?: boolean } = {}) {
  return mount(PlaygroundSchemaDialog, {
    props: { open: true, schema: null, ...props },
    global: { stubs: { ODialog, OCheckbox, OTextarea, OBanner } },
  });
}

const WARNING = '[data-test="ai-playground-schema-unsupported"]';

describe("PlaygroundSchemaDialog", () => {
  it("starts off with the default schema in place, ready to be turned on", () => {
    const wrapper = mountDialog();
    expect(wrapper.find("input[type=checkbox]").attributes("checked")).toBeUndefined();
    expect(wrapper.find("textarea").attributes("data-disabled")).toBe("true");
    expect((wrapper.find("textarea").element as HTMLTextAreaElement).value).toContain("grounded");
  });

  it("emits null when the toggle is off, keeping the text for the next open", async () => {
    const wrapper = mountDialog({ schema: '{"type":"object"}' });
    await wrapper.find("input[type=checkbox]").setValue(false);
    await wrapper.find(".primary").trigger("click");
    expect(wrapper.emitted("apply")?.[0]?.[0]).toBeNull();
  });

  it("blocks Apply on unparseable JSON", async () => {
    const wrapper = mountDialog({ schema: "{}" });
    await wrapper.find("textarea").setValue("{ not json");
    expect(wrapper.find(".o-dialog").attributes("data-primary-disabled")).toBe("true");
  });

  // Said before the schema is written rather than after an answer arrives as
  // prose: the request drops the schema silently, so the dialog is the only
  // place the drop can be read.
  it("warns when the provider carries no schema", () => {
    expect(mountDialog({ dropped: true }).find(WARNING).exists()).toBe(true);
    expect(mountDialog({ dropped: false }).find(WARNING).exists()).toBe(false);
  });

  // The variant keeps the schema whatever the provider is, and swapping the
  // model is what makes it live — so the fields stay usable behind the warning.
  it("still lets a schema be written for such a provider", async () => {
    const wrapper = mountDialog({ dropped: true });
    await wrapper.find("input[type=checkbox]").setValue(true);
    await wrapper.find("textarea").setValue('{"type":"object"}');
    await wrapper.find(".primary").trigger("click");
    expect(wrapper.emitted("apply")?.[0]?.[0]).toBe('{"type":"object"}');
  });
});
