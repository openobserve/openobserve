// Copyright 2026 OpenObserve Inc.
// @vitest-environment jsdom

import { describe, expect, it } from "vitest";
import { mount } from "@vue/test-utils";
import type { ExperimentRowDetail } from "@/services/llm-experiments.service";
import ExperimentComparisonRowDrawer from "./ExperimentComparisonRowDrawer.vue";

function detail(experimentId: string, output: string, score: number): ExperimentRowDetail {
  return {
    experimentId,
    snapshot: { datasetId: "dataset", datasetVersion: 1 },
    navigation: {
      rowIndex: 0,
      totalRows: 1,
      previousRowId: null,
      nextRowId: null,
    },
    rowId: `${experimentId}-row`,
    logicalId: "case-1",
    input: { question: "When?" },
    expectedOutput: "Tomorrow",
    trials: [
      {
        rowId: `${experimentId}-row`,
        logicalId: "case-1",
        trialIndex: 0,
        input: { question: "When?" },
        expectedOutput: "Tomorrow",
        taskStatus: "ok",
        execution: {
          experimentId,
          itemLogicalId: "case-1",
          rowId: `${experimentId}-row`,
          trialIndex: 0,
          status: "ok",
          output,
          errorMessage: null,
          latencyMs: 1,
          tokensIn: 1,
          tokensOut: 1,
          cost: 0.1,
          traceId: null,
          taskFingerprint: null,
          timestamp: 1,
        },
        scores: [
          {
            scorerId: "quality",
            scorerVersion: 1,
            status: "success",
            score: { value_numeric: score },
          },
        ],
      },
    ],
    scoreSummaries: [],
  };
}

const row = {
  logicalId: "case-1",
  baselineRowId: "old-row",
  candidateRowId: "new-row",
  bucket: "regressed" as const,
  dimensions: [
    {
      name: "749570578629158502 · v1",
      kind: "score" as const,
      baseline: 0.92,
      candidate: 0.59,
      delta: -0.33,
      orientedDelta: -0.33,
      gating: true,
      normalized: true,
      baselineSampleCount: 1,
      candidateSampleCount: 1,
      assignment: "regressed" as const,
    },
  ],
};

function mountDrawer(props: Record<string, unknown> = {}) {
  return mount(ExperimentComparisonRowDrawer, {
    props: {
      open: true,
      row,
      baselineId: "baseline",
      candidateId: "candidate",
      baseline: detail("baseline", "Old answer", 0.4),
      candidate: detail("candidate", "New answer", 0.9),
      ...props,
    },
    global: {
      stubs: {
        ODrawer: {
          props: ["open"],
          template: '<section v-if="open"><slot /><slot name="footer" /></section>',
        },
        OTag: { props: ["label"], template: "<span>{{ label }}<slot /></span>" },
        // `emits` declared so the parent's @click is NOT also inherited as a
        // native listener, which would fire every step twice.
        OButton: {
          emits: ["click"],
          template: '<button v-bind="$attrs" @click="$emit(\'click\')"><slot /></button>',
        },
        OToggleGroup: { template: "<div><slot /></div>" },
        OToggleGroupItem: { template: "<button><slot /></button>" },
        LLMContentRenderer: {
          props: ["content"],
          template: "<div>{{ content }}</div>",
        },
        OTable: {
          props: ["data", "columns"],
          template: `<table><tr v-for="r in data" :key="r.key" data-test="score-row">
            <td v-for="c in columns" :key="c.id">{{ r[c.accessorKey] }}<slot :name="'cell-' + c.id" :row="r" /></td>
          </tr></table>`,
        },
      },
    },
  });
}

describe("ExperimentComparisonRowDrawer", () => {
  it("shows the dataset input and expected output once, not per side", () => {
    const wrapper = mountDrawer();

    // Both sides read the same dataset row, so duplicating them was noise.
    expect(wrapper.findAll('[data-test="ai-experiment-comparison-input"]')).toHaveLength(1);
    expect(wrapper.findAll('[data-test="ai-experiment-comparison-expected"]')).toHaveLength(1);
    expect(wrapper.get('[data-test="ai-experiment-comparison-expected"]').text()).toContain(
      "Tomorrow",
    );
  });

  it("puts only the outputs side by side", () => {
    const wrapper = mountDrawer();

    expect(wrapper.get('[data-test="ai-experiment-comparison-baseline-output"]').text()).toContain(
      "Old answer",
    );
    expect(wrapper.get('[data-test="ai-experiment-comparison-candidate-output"]').text()).toContain(
      "New answer",
    );
  });

  it("tabulates each dimension with its delta, named by scorer", () => {
    const wrapper = mountDrawer({ scorerNames: { "749570578629158502": "correctness" } });
    const scores = wrapper.get('[data-test="score-row"]').text();

    expect(scores).toContain("correctness · v1");
    expect(scores).toContain("0.92");
    expect(scores).toContain("0.59");
    expect(scores).toContain("-0.33");
  });

  it("steps through rows from an icon-only footer stepper", async () => {
    const wrapper = mountDrawer({ index: 2, total: 3, hasPrevious: true, hasNext: true });
    const nav = wrapper.get('[data-test="ai-experiment-comparison-nav"]');

    expect(nav.text()).toContain("Row 2 of 3");
    // Icon-only: the position readout beside it already says what they do.
    expect(nav.text()).not.toContain("Previous");

    await wrapper.get('[data-test="ai-experiment-comparison-nav-previous"]').trigger("click");
    await wrapper.get('[data-test="ai-experiment-comparison-nav-next"]').trigger("click");
    expect(wrapper.emitted("step")).toEqual([[-1], [1]]);
  });

  it("closes off the ends so you cannot page past the first or last row", () => {
    const first = mountDrawer({ index: 1, total: 3, hasPrevious: false, hasNext: true });
    expect(
      first.get('[data-test="ai-experiment-comparison-nav-previous"]').attributes("disabled"),
    ).toBeDefined();
    expect(
      first.get('[data-test="ai-experiment-comparison-nav-next"]').attributes("disabled"),
    ).toBeUndefined();

    const last = mountDrawer({ index: 3, total: 3, hasPrevious: true, hasNext: false });
    expect(
      last.get('[data-test="ai-experiment-comparison-nav-next"]').attributes("disabled"),
    ).toBeDefined();
  });

  it("hides the stepper when there is nothing to step through", () => {
    const wrapper = mountDrawer({ index: 1, total: 1 });
    expect(wrapper.find('[data-test="ai-experiment-comparison-nav"]').exists()).toBe(false);
  });

  it("says a side is absent rather than showing it as empty", () => {
    const wrapper = mountDrawer({ candidate: null });

    expect(wrapper.get('[data-test="ai-experiment-comparison-candidate-output"]').text()).toContain(
      "Not present in this run",
    );
  });
});
