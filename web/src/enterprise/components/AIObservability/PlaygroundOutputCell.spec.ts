// Copyright 2026 OpenObserve Inc.
// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { mount } from "@vue/test-utils";
import PlaygroundOutputCell from "./PlaygroundOutputCell.vue";
import { idleCell, type PlaygroundCell } from "@/enterprise/views/AIObservability/playgroundDraft";

vi.mock("@/types/i18n", async () => {
  const actual = await vi.importActual<typeof import("@/types/i18n")>("@/types/i18n");
  // Echo the interpolation params: the cell's job is to format latency, tokens
  // and cost, and a key-only stub would assert nothing about that.
  return {
    ...actual,
    useI18nTyped: () => ({
      t: (key: string, params?: Record<string, unknown>) =>
        params ? `${key} ${Object.values(params).join(" ")}` : key,
    }),
  };
});

const OBanner = {
  props: ["variant", "dense", "content", "icon", "inlineActions"],
  template: '<div class="o-banner" :data-variant="variant" :data-content="content"><slot /></div>',
};
const OButton = {
  props: ["variant", "size", "iconLeft", "title"],
  emits: ["click"],
  template: '<button class="o-button" @click="$emit(\'click\')"><slot /></button>',
};
const OTag = {
  props: ["variant", "size", "label"],
  template: '<span class="o-tag" :data-label="label" />',
};

function mountCell(cell: PlaygroundCell | undefined, props: Record<string, unknown> = {}) {
  return mount(PlaygroundOutputCell, {
    props: { cell, ...props },
    global: { stubs: { OBanner, OButton, OTag } },
  });
}

function doneCell(overrides: Partial<PlaygroundCell> = {}): PlaygroundCell {
  return {
    ...idleCell(),
    status: "done",
    text: "The refund window is 30 days.",
    usage: { promptTokens: 42, completionTokens: 9, costUsd: 0.000128, latencyMs: 1500 },
    ...overrides,
  };
}

describe("PlaygroundOutputCell", () => {
  it("shows the idle prompt before anything has run", () => {
    const wrapper = mountCell(undefined);
    expect(wrapper.find('[data-test="ai-playground-output-idle"]').text()).toBe(
      "aiObservability.playground.outputPlaceholder",
    );
  });

  it("uses the terser idle copy in a table cell", () => {
    const wrapper = mountCell(undefined, { compact: true });
    expect(wrapper.find('[data-test="ai-playground-output-idle"]').text()).toBe(
      "aiObservability.playground.outputNotRun",
    );
  });

  it("renders streamed text as it arrives, with a caret", () => {
    const wrapper = mountCell({ ...idleCell(), status: "streaming", text: "The refund" });
    const text = wrapper.find('[data-test="ai-playground-output-text"]');

    expect(text.text()).toContain("The refund");
    expect(text.find(".animate-pulse").exists()).toBe(true);
  });

  it("hides usage while still streaming — a partial total would be wrong", () => {
    const wrapper = mountCell({ ...doneCell(), status: "streaming" });
    expect(wrapper.find('[data-test="ai-playground-output-usage"]').exists()).toBe(false);
  });

  it("reports latency, tokens and cost once the run is done", () => {
    const usage = mountCell(doneCell()).find('[data-test="ai-playground-output-usage"]');
    expect(usage.text()).toContain("1.5");
    expect(usage.text()).toContain("42");
    expect(usage.text()).toContain("0.0001");
  });

  it("lists a verdict per scorer, including the ones that could not run", () => {
    const wrapper = mountCell(
      doneCell({
        scores: [
          {
            scorerId: "s1",
            scorerName: "correctness",
            scorerVersion: 2,
            status: "scored",
            numeric: 0.75,
            categorical: null,
            boolean: null,
            reasoning: "close enough",
            reason: null,
            error: null,
          },
          {
            scorerId: "s2",
            scorerName: "policy",
            scorerVersion: 1,
            status: "skipped",
            numeric: null,
            categorical: null,
            boolean: null,
            reasoning: null,
            reason: "no_reference",
            error: null,
          },
        ],
      }),
    );

    const scores = wrapper.find('[data-test="ai-playground-output-scores"]');
    expect(scores.exists()).toBe(true);
    expect(wrapper.find('[data-test="ai-playground-score-s1"]').text()).toContain("close enough");
    expect(wrapper.find('[data-test="ai-playground-score-s2"]').exists()).toBe(true);
  });

  it("says so while the judges are still running", () => {
    const wrapper = mountCell(doneCell({ scoring: true }));
    expect(wrapper.find('[data-test="ai-playground-output-scores"]').exists()).toBe(true);
  });

  it("offers a retry on error and emits it", async () => {
    const wrapper = mountCell({
      ...idleCell(),
      status: "error",
      error: { message: "provider 429", retryable: true },
    });

    expect(
      wrapper.find('[data-test="ai-playground-output-error"]').attributes("data-content"),
    ).toBe("provider 429");
    await wrapper.find('[data-test="ai-playground-output-retry"]').trigger("click");
    expect(wrapper.emitted("retry")).toHaveLength(1);
  });

  it("renders a tool call as the output, with no answer text", () => {
    const wrapper = mountCell(
      doneCell({ text: "", toolCall: { name: "lookup_order", arguments: '{ "id": 1 }' } }),
    );
    const call = wrapper.find('[data-test="ai-playground-output-tool-call"]');

    expect(call.exists()).toBe(true);
    expect(call.text()).toContain("lookup_order");
    expect(wrapper.find('[data-test="ai-playground-output-text"]').exists()).toBe(false);
  });

  // Copy / Continue Conversation / Create Experiment live on the Output label
  // row now, which PlaygroundVariantColumn owns — see its spec. The cell shows
  // the answer and nothing else, so a long output can never push them away.
  it("carries no action row of its own", () => {
    const wrapper = mountCell(doneCell());
    expect(wrapper.find('[data-test="ai-playground-output-copy"]').exists()).toBe(false);
    expect(wrapper.find('[data-test="ai-playground-output-add-to-messages"]').exists()).toBe(false);
    expect(wrapper.find('[data-test="ai-playground-output-create-experiment"]').exists()).toBe(
      false,
    );
  });
});
