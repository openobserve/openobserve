// Copyright 2026 OpenObserve Inc.

import { beforeEach, describe, expect, it } from "vitest";
import type { ExperimentDetail, LlmExperiment } from "@/services/llm-experiments.service";
import {
  comparisonEligibility,
  experimentEvidence,
  fetchExperimentDetails,
  groupExperiments,
  readExperimentBaselines,
  writeExperimentBaselines,
} from "./experimentDiscovery";

const experiment = (id: string, datasetId: string, createdAt: number): LlmExperiment => ({
  id,
  orgId: "acme",
  name: id,
  datasetId,
  datasetVersion: 1,
  task: { type: "remote", config: {} },
  scorers: [],
  trialCount: 1,
  status: "completed",
  createdBy: "test",
  createdAt,
});

beforeEach(() => localStorage.clear());

describe("experiment discovery", () => {
  it("groups by dataset, keeps filters independent, and pins the baseline first", () => {
    const rows = [
      experiment("old", "dataset-a", 1),
      experiment("new", "dataset-a", 2),
      experiment("other", "dataset-b", 3),
    ];
    const groups = groupExperiments(
      rows,
      new Map([["dataset-a", "Dataset A"]]),
      { "dataset-a": "old" },
      "dataset-a",
      "",
    );

    expect(groups).toHaveLength(1);
    expect(groups[0].datasetName).toBe("Dataset A");
    expect(groups[0].experiments.map(({ id }) => id)).toEqual(["old", "new"]);
    expect(groupExperiments(rows, new Map(), {}, "", "oth")[0].experiments[0].id).toBe("other");
  });

  it("reports why cross-dataset comparison is unavailable", () => {
    expect(comparisonEligibility([experiment("a", "one", 1), experiment("b", "two", 2)])).toEqual({
      eligible: false,
      reason: "Experiments can only be compared when they use the same dataset.",
    });
    expect(
      comparisonEligibility([experiment("a", "one", 1), experiment("b", "one", 2)]).eligible,
    ).toBe(true);
  });

  it("summarizes distinct completed slots, numeric scores, and cost", () => {
    const base = experiment("a", "one", 1);
    const detail = {
      experiment: base,
      preview: {
        datasetId: "one",
        datasetVersion: 1,
        rowCount: 2,
        trialCount: 1,
        slotCount: 2,
        pinnedScorers: [],
        sampleSlots: [],
      },
      results: {
        executions: [
          {
            experimentId: "a",
            itemLogicalId: "one",
            rowId: "row-1",
            trialIndex: 0,
            status: "ok",
            output: null,
            errorMessage: null,
            latencyMs: 1,
            tokensIn: 1,
            tokensOut: 1,
            cost: 0.1,
            traceId: null,
            timestamp: 1,
          },
          {
            experimentId: "a",
            itemLogicalId: "one",
            rowId: "row-1",
            trialIndex: 0,
            status: "ok",
            output: null,
            errorMessage: null,
            latencyMs: 1,
            tokensIn: 1,
            tokensOut: 1,
            cost: 0.2,
            traceId: null,
            timestamp: 2,
          },
        ],
        scores: [
          { name: "quality", value_numeric: 0.5 },
          { name: "quality", value_numeric: 1 },
        ],
      },
    } satisfies ExperimentDetail;

    expect(experimentEvidence(detail)).toEqual({
      completedSlots: 1,
      totalSlots: 2,
      cost: 0.30000000000000004,
      scores: [{ name: "quality", value: 0.75 }],
    });
  });

  it("persists one baseline per dataset and tolerates malformed storage", () => {
    writeExperimentBaselines("acme", { one: "experiment-a" });
    expect(readExperimentBaselines("acme")).toEqual({ one: "experiment-a" });
    localStorage.setItem("o2_experiment_baselines_acme", "not-json");
    expect(readExperimentBaselines("acme")).toEqual({});
  });

  it("hydrates available details without failing the whole browse surface", async () => {
    const rows = [experiment("one", "dataset-a", 1), experiment("two", "dataset-a", 2)];
    const detail = {
      experiment: rows[0],
      preview: {
        datasetId: "dataset-a",
        datasetVersion: 1,
        rowCount: 0,
        trialCount: 1,
        slotCount: 0,
        pinnedScorers: [],
        sampleSlots: [],
      },
      results: { executions: [], scores: [] },
    } satisfies ExperimentDetail;

    const details = await fetchExperimentDetails(rows, async (id) => {
      if (id === "two") throw new Error("not available");
      return detail;
    });

    expect(details).toEqual({ one: detail });
  });
});
