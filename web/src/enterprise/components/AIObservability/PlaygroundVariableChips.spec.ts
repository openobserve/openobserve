// Copyright 2026 OpenObserve Inc.
// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { mount } from "@vue/test-utils";
import PlaygroundVariableChips from "./PlaygroundVariableChips.vue";
import {
  emptyVariant,
  type PlaygroundVariant,
} from "@/enterprise/views/AIObservability/playgroundDraft";

// Stubs so the spec asserts which chips this component decides to show, not how
// OButton and OTag render — both have their own specs.
const OButton = {
  props: ["variant", "size", "title", "type"],
  emits: ["click"],
  template: '<button class="o-button" @click="$emit(\'click\')"><slot /></button>',
};
const OTag = {
  props: ["variant", "size", "label", "title", "disabled"],
  template: '<span class="o-tag" :data-label="label" :data-disabled="disabled" />',
};

vi.mock("@/types/i18n", async () => {
  const actual = await vi.importActual<typeof import("@/types/i18n")>("@/types/i18n");
  return {
    ...actual,
    useI18nTyped: () => ({ t: (key: string) => key }),
  };
});

function variantWith(contents: string[]): PlaygroundVariant {
  const variant = emptyVariant("p1", "m1");
  variant.messages = contents.map((content, index) => ({
    id: `m${index}`,
    role: index === 0 ? "system" : "user",
    content,
  }));
  return variant;
}

function mountChips(variant: PlaygroundVariant, fields: string[] | null) {
  return mount(PlaygroundVariableChips, {
    props: { variant, fields },
    global: { stubs: { OButton, OTag } },
  });
}

function chipLabels(wrapper: ReturnType<typeof mountChips>) {
  return wrapper.findAll("button.o-button").map((button) => button.text());
}

describe("PlaygroundVariableChips", () => {
  it("renders nothing when there are no variables and no fields", () => {
    expect(
      mountChips(variantWith(["plain", "text"]), null)
        .find("button")
        .exists(),
    ).toBe(false);
  });

  it("in bench mode, offers the template's own variables", () => {
    const wrapper = mountChips(variantWith(["", "Answer {{question}} using {{context}}"]), null);
    expect(chipLabels(wrapper)).toEqual(["{{question}}", "{{context}}"]);
  });

  it("in table mode, offers a row field the template does not use yet", () => {
    const wrapper = mountChips(variantWith(["", "Summarise the policy."]), ["input"]);
    expect(chipLabels(wrapper)).toEqual(["{{input}}"]);
  });

  it("flags a template variable that no current row provides", () => {
    const wrapper = mountChips(variantWith(["", "Use {{missing_field}}"]), ["input"]);
    const missing = wrapper.find('[data-test="ai-playground-var-chip-missing-missing_field"]');
    expect(missing.exists()).toBe(true);
    expect(missing.attributes("data-label")).toBe("{{missing_field}}");
  });

  it("emits the plain field name when a chip is clicked", async () => {
    const wrapper = mountChips(variantWith(["", "Summarise the policy."]), ["input"]);
    await wrapper.find('[data-test="ai-playground-var-chip-input"]').trigger("click");
    expect(wrapper.emitted("insert")).toEqual([["input"]]);
  });

  it("always shows expected_output as a disabled chip, and never as insertable", () => {
    const wrapper = mountChips(variantWith(["", "Summarise {{input}}"]), ["input"]);
    const expected = wrapper.find('[data-test="ai-playground-var-chip-expected"]');

    expect(expected.exists()).toBe(true);
    expect(expected.attributes("data-disabled")).toBeDefined();
    expect(chipLabels(wrapper)).not.toContain("{{expected_output}}");
  });

  it("does not offer expected_output for insertion even when the template uses it", () => {
    const wrapper = mountChips(variantWith(["", "Answer: {{expected_output}}"]), null);
    expect(chipLabels(wrapper)).toEqual([]);
  });
});
