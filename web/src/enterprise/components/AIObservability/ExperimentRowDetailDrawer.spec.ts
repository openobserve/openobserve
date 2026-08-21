// Copyright 2026 OpenObserve Inc.
// @vitest-environment jsdom

import { describe, expect, it } from "vitest";
import { mount } from "@vue/test-utils";
import type { ExperimentRowDetail } from "@/services/llm-experiments.service";
import ExperimentRowDetailDrawer from "./ExperimentRowDetailDrawer.vue";

const detail: ExperimentRowDetail = {
  experimentId: "experiment-1",
  snapshot: { datasetId: "dataset-1", datasetVersion: 7 },
  navigation: {
    rowIndex: 1,
    totalRows: 3,
    previousRowId: "row-0",
    nextRowId: "row-2",
  },
  rowId: "row-1",
  logicalId: "case-1",
  input: { question: "When?" },
  expectedOutput: "Tomorrow",
  trials: [
    {
      rowId: "row-1",
      logicalId: "case-1",
      trialIndex: 0,
      input: { question: "When?" },
      expectedOutput: "Tomorrow",
      taskStatus: "error",
      execution: {
        experimentId: "experiment-1",
        itemLogicalId: "case-1",
        rowId: "row-1",
        trialIndex: 0,
        status: "error",
        output: null,
        errorMessage: "provider timeout",
        latencyMs: 250,
        tokensIn: 12,
        tokensOut: 0,
        cost: 0.001,
        traceId: "trace-1",
        taskFingerprint: "attempt-1",
        timestamp: 100,
      },
      scores: [
        {
          scorerId: "quality",
          scorerVersion: 3,
          status: "success",
          score: {
            value_numeric: 0.5,
            reasoning: "Partially correct",
            source_type: "experiment",
            origin_source_type: "remote",
          },
        },
      ],
    },
  ],
  scoreSummaries: [
    {
      scorerId: "quality",
      scorerVersion: 3,
      name: "quality",
      scoreConfigId: "quality-config",
      scoreConfigName: "quality",
      scoreConfigVersion: 1,
      sampleCount: 1,
      errorCount: 0,
      pendingCount: 0,
      noReferenceCount: 0,
      noTraceCount: 0,
      skippedCount: 0,
      value: { kind: "numeric", mean: 0.5 },
    },
  ],
};

function mountDrawer(rowDetail: ExperimentRowDetail = detail) {
  return mount(ExperimentRowDetailDrawer, {
    props: { open: true, detail: rowDetail },
    global: {
      stubs: {
        ODrawer: {
          props: ["open", "title", "subTitle"],
          template: '<section v-if="open"><slot /><slot name="footer" /></section>',
        },
        OButton: { template: "<button @click=\"$emit('click')\"><slot /></button>" },
        OTag: { template: "<span><slot /></span>" },
      },
    },
  });
}

describe("ExperimentRowDetailDrawer", () => {
  it("uses score-dimension terminology and API names for a running single trial", () => {
    const dimensionId = "7493173168283058177";
    const running = {
      ...detail,
      trials: [
        {
          ...detail.trials[0],
          taskStatus: "in_progress" as const,
          execution: null,
          scores: [
            {
              scorerId: dimensionId,
              scorerVersion: 1,
              status: "pending" as const,
              score: null,
            },
          ],
        },
      ],
      scoreSummaries: [
        {
          ...detail.scoreSummaries[0],
          scorerId: dimensionId,
          scorerVersion: 1,
          name: "answer_relevance",
          scoreConfigId: "answer-relevance-config",
          scoreConfigName: "answer_relevance",
          scoreConfigVersion: 1,
          sampleCount: 0,
          pendingCount: 1,
          value: null,
        },
      ],
    } as ExperimentRowDetail;

    const wrapper = mountDrawer(running);
    const headers = wrapper.findAll("thead th").map((header) => header.text());

    expect(headers).toEqual(["Dimension", "Trial 1"]);
    expect(wrapper.text()).toContain("answer_relevance");
    expect(wrapper.text()).not.toContain(dimensionId);
  });

  it("renders frozen evidence, execution facts, and scores", () => {
    const wrapper = mountDrawer();

    expect(wrapper.text()).toContain("When?");
    expect(wrapper.text()).toContain("Tomorrow");
    expect(wrapper.text()).toContain("provider timeout");
    expect(wrapper.text()).toContain("0.500");
    expect(wrapper.text()).not.toContain('{"kind":"numeric"');
    expect(wrapper.text()).toContain("Row 2 of 3");
  });

  it("emits row navigation, failed-slot retry, and trace navigation", async () => {
    const wrapper = mountDrawer();

    // The stepper is icon-only now, so target it by hook rather than by label.
    await wrapper.get('[data-test="ai-experiment-row-previous"]').trigger("click");
    const buttons = wrapper.findAll("button");
    await buttons.find((button) => button.text().includes("Retry Failed Slot"))?.trigger("click");
    await buttons.find((button) => button.text().includes("View Trace"))?.trigger("click");

    expect(wrapper.emitted("navigate")?.[0]).toEqual(["row-0"]);
    expect(wrapper.emitted("retry")?.[0]).toEqual([detail.trials[0]]);
    expect(wrapper.emitted("trace")?.[0]).toEqual([detail.trials[0].execution]);
  });
});
