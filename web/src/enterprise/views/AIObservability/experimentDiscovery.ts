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

export type ExperimentDetailFetcher = (experimentId: string) => Promise<ExperimentDetail>;

export async function fetchExperimentDetails(
  experiments: LlmExperiment[],
  fetchDetail: ExperimentDetailFetcher,
): Promise<Record<string, ExperimentDetail>> {
  const settled = await Promise.allSettled(
    experiments.map((experiment) => fetchDetail(experiment.id)),
  );
  return Object.fromEntries(
    settled.flatMap((result) =>
      result.status === "fulfilled" ? [[result.value.experiment.id, result.value] as const] : [],
    ),
  );
}

export function experimentEvidence(detail?: ExperimentDetail): ExperimentEvidence {
  if (!detail) return { completedSlots: 0, totalSlots: 0, cost: null, scores: [] };

  const executions = detail.results.executions;
  const costs = executions
    .map((execution) => execution.cost)
    .filter((cost): cost is number => typeof cost === "number" && Number.isFinite(cost));
  const numericScores = new Map<string, number[]>();
  const booleanScores = new Map<string, boolean[]>();
  const categoricalScores = new Map<string, string[]>();
  for (const score of detail.results.scores) {
    const name = String(
      score.name ?? score.scorer_name ?? score.scorerId ?? score.scorer_id ?? "score",
    );
    if (score.value_numeric !== null && score.value_numeric !== undefined) {
      const value = Number(score.value_numeric);
      if (Number.isFinite(value)) {
        numericScores.set(name, [...(numericScores.get(name) ?? []), value]);
      }
    }
    if (typeof score.value_boolean === "boolean") {
      booleanScores.set(name, [...(booleanScores.get(name) ?? []), score.value_boolean]);
    }
    if (typeof score.value_categorical === "string") {
      categoricalScores.set(name, [
        ...(categoricalScores.get(name) ?? []),
        score.value_categorical,
      ]);
    }
  }

  return {
    completedSlots: new Set(
      executions.map((execution) => `${execution.rowId}:${execution.trialIndex}`),
    ).size,
    totalSlots: detail.preview.slotCount,
    cost: costs.length ? costs.reduce((total, cost) => total + cost, 0) : null,
    scores: [
      ...[...numericScores].map(([name, values]): ExperimentScoreSummary => ({
        name,
        kind: "numeric",
        value: values.reduce((total, value) => total + value, 0) / values.length,
        sampleCount: values.length,
      })),
      ...[...booleanScores].map(([name, values]): ExperimentScoreSummary => ({
        name,
        kind: "boolean",
        trueCount: values.filter(Boolean).length,
        falseCount: values.filter((value) => !value).length,
        sampleCount: values.length,
      })),
      ...[...categoricalScores].map(([name, values]): ExperimentScoreSummary => {
        const counts = new Map<string, number>();
        for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
        return {
          name,
          kind: "categorical",
          values: [...counts].map(([value, count]) => ({ value, count })),
          sampleCount: values.length,
        };
      }),
    ],
  };
}

export function groupExperiments(
  experiments: LlmExperiment[],
  datasetNames: Map<string, string>,
  baselineByDataset: Record<string, string>,
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
      const baselineId = baselineByDataset[datasetId];
      if (left.id === baselineId) return -1;
      if (right.id === baselineId) return 1;
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

export function readExperimentBaselines(orgId: string): Record<string, string> {
  if (!orgId) return {};
  try {
    const parsed = JSON.parse(localStorage.getItem(`o2_experiment_baselines_${orgId}`) ?? "{}");
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

export function writeExperimentBaselines(orgId: string, baselines: Record<string, string>) {
  if (!orgId) return;
  try {
    localStorage.setItem(`o2_experiment_baselines_${orgId}`, JSON.stringify(baselines));
  } catch {
    // The selection remains available for the current page if storage is unavailable.
  }
}
