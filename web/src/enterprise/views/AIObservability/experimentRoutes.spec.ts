// Copyright 2026 OpenObserve Inc.

import { describe, expect, it } from "vitest";
import { aiExperimentsRoute } from "./experimentRoutes";

describe("aiExperimentsRoute", () => {
  it("builds dataset, detail, and comparison deep links through one route contract", () => {
    expect(aiExperimentsRoute("acme", { datasetId: "dataset-a" })).toEqual({
      name: "aiExperiments",
      query: { org_identifier: "acme", dataset: "dataset-a" },
    });
    expect(
      aiExperimentsRoute("acme", {
        query: { experiment: "quality" },
        datasetId: "dataset-a",
        selectedId: "experiment-1",
        baselineId: "baseline-1",
        candidateId: "candidate-1",
      }),
    ).toEqual({
      name: "aiExperiments",
      query: {
        experiment: "quality",
        org_identifier: "acme",
        dataset: "dataset-a",
        selected: "experiment-1",
        baseline: "baseline-1",
        candidate: "candidate-1",
      },
    });
  });
});
