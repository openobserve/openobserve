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

import type { LlmExperiment } from "@/services/llm-experiments.service";

export type ExperimentScoreSummary =
  | { name: string; kind: "numeric"; value: number; sampleCount: number }
  | {
      name: string;
      kind: "boolean";
      trueCount: number;
      falseCount: number;
      sampleCount: number;
    }
  | {
      name: string;
      kind: "categorical";
      values: Array<{ value: string; count: number }>;
      sampleCount: number;
    };

export interface ExperimentEvidence {
  completedSlots: number;
  totalSlots: number;
  cost: number | null;
  scores: ExperimentScoreSummary[];
}

export interface ExperimentDatasetGroup {
  datasetId: string;
  datasetName: string;
  experiments: LlmExperiment[];
}

/**
 * The row's own `includeSummary` fields already carry the type-aware
 * aggregate per scorer, so this only reshapes it for the browse table's
 * per-scorer column — it never needs raw execution/score records.
 */
export function experimentEvidence(experiment: LlmExperiment): ExperimentEvidence {
  const scores: ExperimentScoreSummary[] = [];
  for (const summary of experiment.scoreSummaries ?? []) {
    const aggregate = summary.value as Record<string, unknown> | null;
    if (!aggregate) continue;
    const name = summary.scoreConfigName || summary.name;
    if (aggregate.kind === "numeric") {
      scores.push({
        name,
        kind: "numeric",
        value: Number(aggregate.mean ?? 0),
        sampleCount: summary.sampleCount,
      });
    } else if (aggregate.kind === "boolean") {
      scores.push({
        name,
        kind: "boolean",
        trueCount: Number(aggregate.trueCount ?? aggregate.true_count ?? 0),
        falseCount: Number(aggregate.falseCount ?? aggregate.false_count ?? 0),
        sampleCount: summary.sampleCount,
      });
    } else if (aggregate.kind === "categorical") {
      const counts = (aggregate.counts ?? {}) as Record<string, number>;
      scores.push({
        name,
        kind: "categorical",
        values: Object.entries(counts).map(([value, count]) => ({ value, count: Number(count) })),
        sampleCount: summary.sampleCount,
      });
    }
  }

  return {
    completedSlots: experiment.executionProgress?.completed ?? 0,
    totalSlots: experiment.executionProgress?.total ?? 0,
    cost: experiment.aggregateSummary?.totalCost ?? null,
    scores,
  };
}

export function groupExperiments(
  experiments: LlmExperiment[],
  datasetNames: Map<string, string>,
  datasetFilter: string,
  nameSearch: string,
): ExperimentDatasetGroup[] {
  const query = nameSearch.trim().toLocaleLowerCase();
  const groups = new Map<string, LlmExperiment[]>();
  for (const experiment of experiments) {
    if (datasetFilter && experiment.datasetId !== datasetFilter) continue;
    if (query && !experiment.name.toLocaleLowerCase().includes(query)) continue;
    groups.set(experiment.datasetId, [...(groups.get(experiment.datasetId) ?? []), experiment]);
  }

  return [...groups].map(([datasetId, rows]) => ({
    datasetId,
    datasetName: datasetNames.get(datasetId) ?? datasetId,
    experiments: rows.sort((left, right) => {
      if (left.isBaseline) return -1;
      if (right.isBaseline) return 1;
      return right.createdAt - left.createdAt || left.id.localeCompare(right.id);
    }),
  }));
}

export type ComparisonIneligibilityReason = "select_two" | "select_only_two" | "different_dataset";

export function comparisonEligibility(experiments: LlmExperiment[]): {
  eligible: boolean;
  reason: ComparisonIneligibilityReason | null;
} {
  if (experiments.length < 2) {
    return { eligible: false, reason: "select_two" };
  }
  if (experiments.length > 2) {
    return { eligible: false, reason: "select_only_two" };
  }
  if (experiments[0].datasetId !== experiments[1].datasetId) {
    return { eligible: false, reason: "different_dataset" };
  }
  return { eligible: true, reason: null };
}
