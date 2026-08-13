// Copyright 2026 OpenObserve Inc.

import type { ExperimentDetail, LlmExperiment } from "@/services/llm-experiments.service";

export function makeExperiment(overrides: Partial<LlmExperiment> = {}): LlmExperiment {
  return {
    id: "experiment-1",
    orgId: "acme",
    name: "Experiment",
    datasetId: "dataset-a",
    datasetVersion: 1,
    task: { type: "remote", config: {} },
    scorers: [],
    trialCount: 1,
    status: "completed",
    statusReason: null,
    deadlineAt: 1_800_086_400_000,
    completedAt: 1_800_000_000_100,
    lifecycleVersion: 1,
    retryCount: 0,
    createdBy: "test",
    createdAt: 1_800_000_000_000,
    ...overrides,
  };
}

export function makeExperimentDetail(
  experiment: LlmExperiment,
  overrides: Partial<ExperimentDetail> = {},
): ExperimentDetail {
  return {
    experiment,
    preview: {
      datasetId: experiment.datasetId,
      datasetVersion: experiment.datasetVersion,
      rowCount: 0,
      trialCount: experiment.trialCount,
      slotCount: 0,
      pinnedScorers: experiment.scorers,
      sampleSlots: [],
    },
    results: { executions: [], scores: [] },
    ...overrides,
  };
}
