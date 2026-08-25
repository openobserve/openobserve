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

import PlaygroundCompareTable from "./PlaygroundCompareTable.vue";
import {
  emptyVariant,
  starterDraft,
  type PlaygroundDraft,
  type PlaygroundResults,
} from "@/enterprise/views/AIObservability/playgroundDraft";

const OBanner = {
  props: ["variant", "dense", "icon", "inlineActions", "content"],
  template: '<div class="o-banner" :data-variant="variant"><slot /><slot name="actions" /></div>',
};
const OButton = {
  props: ["variant", "size", "iconLeft", "title", "disabled"],
  emits: ["click"],
  template: '<button :disabled="disabled" @click="$emit(\'click\')"><slot /></button>',
};

/** Captures the column defs so the spec can assert the shape the table asks for
 *  without depending on how OTable paints them. */
const OTable = {
  props: ["data", "columns", "rowKey", "frame"],
  emits: ["row-click"],
  template: '<div class="o-table" :data-rows="data.length" :data-cols="columns.length" />',
};

function draftWith(prompt: string, rowCount: number): PlaygroundDraft {
  const draft = starterDraft("p1", "gpt-4o-mini");
  draft.variants[0].messages[1].content = prompt;
  draft.rows = Array.from({ length: rowCount }, (_, index) => ({
    id: `r${index}`,
    input: `question ${index}`,
    expectedOutput: index === 0 ? "golden" : null,
    source: null,
  }));
  return draft;
}

function mountTable(draft: PlaygroundDraft, results: PlaygroundResults = {}) {
  return mount(PlaygroundCompareTable, {
    props: { draft, results, streamingVariants: [] },
    global: { stubs: { OBanner, OButton, OTable, OTag: true, PlaygroundOutputCell: true } },
  });
}

describe("PlaygroundCompareTable", () => {
  it("builds one column per variant, plus input and actions", () => {
    const draft = draftWith("Summarise {{input}}", 2);
    draft.variants.push(emptyVariant("p1", "gpt-4o"));

    const table = mountTable(draft).find(".o-table");
    expect(table.attributes("data-cols")).toBe("4");
    expect(table.attributes("data-rows")).toBe("2");
  });

  it("warns when the template references no row field", () => {
    const wrapper = mountTable(draftWith("Summarise the policy.", 3));
    expect(wrapper.find('[data-test="ai-playground-zero-ref-warning"]').exists()).toBe(true);
  });

  it("drops the warning once a row field is bound", () => {
    const wrapper = mountTable(draftWith("Summarise {{input}}", 3));
    expect(wrapper.find('[data-test="ai-playground-zero-ref-warning"]').exists()).toBe(false);
  });

  it("offers the available field as a one-click fix and emits it", async () => {
    const wrapper = mountTable(draftWith("Summarise the policy.", 3));
    await wrapper.find('[data-test="ai-playground-insert-field-input"]').trigger("click");
    expect(wrapper.emitted("insert-field")).toEqual([["input"]]);
  });

  it("disables Add Variant at the four-variant cap", () => {
    const draft = draftWith("Summarise {{input}}", 1);
    while (draft.variants.length < 4) draft.variants.push(emptyVariant("p1", "m"));

    const button = mountTable(draft).find('[data-test="ai-playground-add-variant-btn"]');
    expect(button.attributes("disabled")).toBeDefined();
  });

  it("keeps Add Variant enabled below the cap", () => {
    const button = mountTable(draftWith("Summarise {{input}}", 1)).find(
      '[data-test="ai-playground-add-variant-btn"]',
    );
    expect(button.attributes("disabled")).toBeUndefined();
  });

  it("makes no column sortable — no backend sort stands behind these rows", () => {
    const wrapper = mountTable(draftWith("Summarise {{input}}", 2));
    const columns = wrapper.findComponent(OTable).props("columns") as { sortable?: boolean }[];
    expect(columns.every((column) => !column.sortable)).toBe(true);
  });

  it("points the footer at experiments rather than ranking the columns itself", async () => {
    const wrapper = mountTable(draftWith("Summarise {{input}}", 2));
    await wrapper.find('[data-test="ai-playground-footer-experiment"]').trigger("click");
    expect(wrapper.emitted("create-experiment")).toBeTruthy();
  });
});
