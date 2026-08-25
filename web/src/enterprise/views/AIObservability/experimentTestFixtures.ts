// Copyright 2026 OpenObserve Inc.
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// This program is distributed in the hope that it will be useful
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with this program.  If not, see <http://www.gnu.org/licenses/>.

import type { ExperimentDetail, LlmExperiment } from "@/services/llm-experiments.service";

export function makeExperiment(overrides: Partial<LlmExperiment> = {}): LlmExperiment {
  return {
    id: "experiment-1",
    orgId: "acme",
    name: "Experiment",
    datasetId: "dataset-a",
    datasetName: "Dataset A",
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
