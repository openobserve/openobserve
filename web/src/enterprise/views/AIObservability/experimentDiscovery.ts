// Copyright 2026 OpenObserve Inc.

import type { ExperimentDetail, LlmExperiment } from "@/services/llm-experiments.service";

export interface ExperimentEvidence {
  completedSlots: number;
  totalSlots: number;
  cost: number | null;
  scores: Array<{ name: string; value: number }>;
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
  for (const score of detail.results.scores) {
    const name = String(
      score.name ?? score.scorer_name ?? score.scorerId ?? score.scorer_id ?? "score",
    );
    const value = Number(score.value_numeric ?? score.value ?? Number.NaN);
    if (!Number.isFinite(value)) continue;
    numericScores.set(name, [...(numericScores.get(name) ?? []), value]);
  }

  return {
    completedSlots: new Set(
      executions.map((execution) => `${execution.rowId}:${execution.trialIndex}`),
    ).size,
    totalSlots: detail.preview.slotCount,
    cost: costs.length ? costs.reduce((total, cost) => total + cost, 0) : null,
    scores: [...numericScores].map(([name, values]) => ({
      name,
      value: values.reduce((total, value) => total + value, 0) / values.length,
    })),
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

export function comparisonEligibility(experiments: LlmExperiment[]) {
  if (experiments.length < 2) {
    return { eligible: false, reason: "Select two experiments to compare." };
  }
  if (experiments.length > 2) {
    return { eligible: false, reason: "Select only two experiments to compare." };
  }
  if (experiments[0].datasetId !== experiments[1].datasetId) {
    return {
      eligible: false,
      reason: "Experiments can only be compared when they use the same dataset.",
    };
  }
  return { eligible: true, reason: "" };
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
