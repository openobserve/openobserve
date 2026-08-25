// Copyright 2026 OpenObserve Inc.
// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { mount } from "@vue/test-utils";

vi.mock("@/types/i18n", async () => {
  const actual = await vi.importActual<typeof import("@/types/i18n")>("@/types/i18n");
  return {
    ...actual,
    useI18nTyped: () => ({
      t: (key: string, params?: Record<string, unknown>) =>
        params ? `${key} ${Object.values(params).join(" ")}` : key,
    }),
  };
});

import PlaygroundRowDrawer from "./PlaygroundRowDrawer.vue";
import {
  emptyVariant,
  idleCell,
  starterDraft,
  type PlaygroundDraft,
  type PlaygroundResults,
} from "@/enterprise/views/AIObservability/playgroundDraft";

const ODrawer = {
  props: ["open", "side", "size", "title"],
  emits: ["update:open"],
  template: '<div class="o-drawer" :data-title="title"><slot name="header-right" /><slot /></div>',
};
const OButton = {
  props: ["variant", "size", "iconLeft", "title", "disabled"],
  emits: ["click"],
  template: '<button :disabled="disabled" @click="$emit(\'click\')"><slot /></button>',
};

function draftWith(prompt: string): PlaygroundDraft {
  const draft = starterDraft("p1", "gpt-4o-mini");
  draft.variants[0].messages[0].content = "You are terse.";
  draft.variants[0].messages[1].content = prompt;
  draft.rows = [
    { id: "r0", input: "the refund policy", expectedOutput: "30 days", source: null },
    { id: "r1", input: "the shipping policy", expectedOutput: null, source: null },
  ];
  return draft;
}

function mountDrawer(draft: PlaygroundDraft, rowIndex = 0, results: PlaygroundResults = {}) {
  return mount(PlaygroundRowDrawer, {
    props: { open: true, draft, results, rowIndex },
    global: {
      stubs: { ODrawer, OButton, OTag: true, OBadge: true, PlaygroundOutputCell: true },
    },
  });
}

describe("PlaygroundRowDrawer", () => {
  it("shows the row's input and reference answer", () => {
    const wrapper = mountDrawer(draftWith("Summarise {{input}}"));
    expect(wrapper.find('[data-test="ai-playground-drawer-input"]').text()).toBe(
      "the refund policy",
    );
    expect(wrapper.find('[data-test="ai-playground-drawer-expected"]').text()).toBe("30 days");
  });

  it("says plainly when a row carries no reference answer", () => {
    const wrapper = mountDrawer(draftWith("Summarise {{input}}"), 1);
    expect(wrapper.find('[data-test="ai-playground-drawer-expected"]').exists()).toBe(false);
    expect(wrapper.text()).toContain("aiObservability.playground.drawerNoExpected");
  });

  it("keeps the rendered prompt collapsed until asked for", () => {
    const wrapper = mountDrawer(draftWith("Summarise {{input}}"));
    expect(wrapper.text()).not.toContain("the refund policy\n");
  });

  it("substitutes the row's values into the rendered prompt", async () => {
    const wrapper = mountDrawer(draftWith("Summarise {{input}}"));
    await wrapper.find('[data-test="ai-playground-drawer-rendered-toggle"]').trigger("click");
    expect(wrapper.text()).toContain("Summarise the refund policy");
  });

  it("renders an unbound variable as empty rather than leaving the literal", async () => {
    const wrapper = mountDrawer(draftWith("Summarise {{nowhere}}"));
    await wrapper.find('[data-test="ai-playground-drawer-rendered-toggle"]').trigger("click");
    expect(wrapper.text()).not.toContain("{{nowhere}}");
  });

  it("offers a variant picker for the rendered prompt only when variants differ", async () => {
    const single = mountDrawer(draftWith("Summarise {{input}}"));
    await single.find('[data-test="ai-playground-drawer-rendered-toggle"]').trigger("click");
    expect(single.find('[data-test="ai-playground-drawer-prompt-variant-A"]').exists()).toBe(false);

    const draft = draftWith("Summarise {{input}}");
    draft.variants.push(emptyVariant("p1", "gpt-4o"));
    const many = mountDrawer(draft);
    await many.find('[data-test="ai-playground-drawer-rendered-toggle"]').trigger("click");
    expect(many.find('[data-test="ai-playground-drawer-prompt-variant-B"]').exists()).toBe(true);
  });

  it("disables the previous control on the first row and next on the last", () => {
    const first = mountDrawer(draftWith("Summarise {{input}}"), 0);
    expect(first.find('[data-test="ai-playground-row-prev"]').attributes("disabled")).toBeDefined();
    expect(
      first.find('[data-test="ai-playground-row-next"]').attributes("disabled"),
    ).toBeUndefined();

    const last = mountDrawer(draftWith("Summarise {{input}}"), 1);
    expect(last.find('[data-test="ai-playground-row-next"]').attributes("disabled")).toBeDefined();
  });

  it("emits a direction when navigating rows", async () => {
    const wrapper = mountDrawer(draftWith("Summarise {{input}}"), 0);
    await wrapper.find('[data-test="ai-playground-row-next"]').trigger("click");
    expect(wrapper.emitted("navigate")).toEqual([[1]]);
  });

  it("passes each variant's cell for this row to its output panel", () => {
    const draft = draftWith("Summarise {{input}}");
    const variantId = draft.variants[0].id;
    const results: PlaygroundResults = {
      [variantId]: { r0: { ...idleCell(), status: "done", text: "row zero answer" } },
    };

    const wrapper = mountDrawer(draft, 0, results);
    const outputs = wrapper.findAllComponents({ name: "PlaygroundOutputCell" });
    expect(outputs[0].props("cell")).toMatchObject({ text: "row zero answer" });
  });
});
