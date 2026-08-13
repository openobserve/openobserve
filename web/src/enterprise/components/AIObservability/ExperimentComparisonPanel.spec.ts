// Copyright 2026 OpenObserve Inc.
// @vitest-environment jsdom

import { describe, expect, it } from "vitest";
import { mount } from "@vue/test-utils";
import type { ExperimentComparison } from "@/services/llm-experiments.service";
import ExperimentComparisonPanel from "./ExperimentComparisonPanel.vue";

const comparison: ExperimentComparison = {
  baselineId: "baseline",
  candidateId: "candidate",
  datasetId: "dataset",
  threshold: 0.05,
  assignmentRule: "Any regression wins; one-sided evidence is neutral.",
  counts: {
    baselineRows: 4,
    candidateRows: 4,
    commonRows: 3,
    regressed: 1,
    improved: 1,
    unchanged: 1,
    new: 1,
    missing: 1,
  },
  dimensions: [
    {
      name: "quality",
      kind: "score",
      baseline: 0.8,
      candidate: 0.7,
      delta: -0.1,
      baselineSampleCount: 3,
      candidateSampleCount: 2,
      comparableRowCount: 2,
      baselineOnlyRowCount: 1,
      candidateOnlyRowCount: 0,
      assignment: "unchanged",
    },
  ],
  rows: [
    {
      logicalId: "case-1",
      baselineRowId: "old-row",
      candidateRowId: "new-row",
      bucket: "regressed",
      dimensions: [],
    },
  ],
};

function mountPanel() {
  return mount(ExperimentComparisonPanel, {
    props: { comparison },
    global: {
      stubs: {
        OInput: {
          props: ["modelValue"],
          emits: ["update:modelValue"],
          template:
            '<input :value="modelValue" @input="$emit(\'update:modelValue\', $event.target.value)" />',
        },
        OButton: { template: "<button @click=\"$emit('click')\"><slot /></button>" },
        OTag: { template: "<span><slot /></span>" },
        OTable: {
          props: ["data"],
          template:
            '<div><div v-for="row in data" :key="row.logicalId"><slot name="cell-bucket" :row="row" /><slot name="cell-dimensions" :row="row" /><slot name="cell-actions" :row="row" /></div></div>',
        },
      },
    },
  });
}

describe("ExperimentComparisonPanel", () => {
  it("shows honest common-row counts, the assignment rule, and one-sided coverage", () => {
    const wrapper = mountPanel();

    expect(wrapper.get('[data-test="ai-experiment-counts"]').text()).toContain("3");
    expect(wrapper.get('[data-test="ai-experiment-comparison-rule"]').text()).toContain(
      "Any regression wins",
    );
    expect(wrapper.get('[data-test="ai-experiment-one-sided-dimension"]').text()).toContain(
      "1 baseline-only",
    );
    expect(wrapper.text()).toContain("3/2 samples");
  });

  it("emits threshold changes and the exact joined row for inspection", async () => {
    const wrapper = mountPanel();
    await wrapper.get("input").setValue("0.2");
    await wrapper
      .findAll("button")
      .find((button) => button.text() === "Apply")
      ?.trigger("click");
    await wrapper.get('[data-test="ai-experiment-comparison-inspect"]').trigger("click");

    expect(wrapper.emitted("apply-threshold")?.[0]).toEqual([0.2]);
    expect(wrapper.emitted("inspect")?.[0]).toEqual([comparison.rows[0]]);
  });
});
