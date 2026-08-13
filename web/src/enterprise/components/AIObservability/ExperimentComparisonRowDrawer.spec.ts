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

describe("ExperimentComparisonRowDrawer", () => {
  it("renders baseline and candidate outputs and scores side by side", () => {
    const wrapper = mount(ExperimentComparisonRowDrawer, {
      props: {
        open: true,
        row: {
          logicalId: "case-1",
          baselineRowId: "old-row",
          candidateRowId: "new-row",
          bucket: "improved",
          dimensions: [],
        },
        baselineId: "baseline",
        candidateId: "candidate",
        baseline: detail("baseline", "Old answer", 0.4),
        candidate: detail("candidate", "New answer", 0.9),
      },
      global: {
        stubs: {
          ODrawer: { props: ["open"], template: '<section v-if="open"><slot /></section>' },
          OTag: { template: "<span><slot /></span>" },
        },
      },
    });

    const baseline = wrapper.get('[data-test="ai-experiment-comparison-baseline"]').text();
    const candidate = wrapper.get('[data-test="ai-experiment-comparison-candidate"]').text();
    expect(baseline).toContain("Old answer");
    expect(baseline).toContain("0.4");
    expect(candidate).toContain("New answer");
    expect(candidate).toContain("0.9");
  });
});
