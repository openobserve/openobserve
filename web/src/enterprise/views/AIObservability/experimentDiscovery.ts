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

import type {
  ExperimentClientScoreSummary,
  LlmExperiment,
} from "@/services/llm-experiments.service";
import { raw, type I18nText, type TranslateFn } from "@/types/i18n";

/** `key` identifies a column across runs: Score Config name, or (config, client key) for client dimensions. */
export type ExperimentScoreSummary = {
  key: string;
  name: string;
  scoreConfigId: string | null;
  clientScorerKey: string | null;
  sampleCount: number;
  errorCount: number;
  pendingCount: number;
} & (
  | { kind: "numeric"; value: number }
  | { kind: "boolean"; trueCount: number; falseCount: number }
  | { kind: "categorical"; values: Array<{ value: string; count: number }> }
);

/** A client dimension's column identity. Two client keys under one Score Config stay two columns. */
export function clientScoreKey(scoreConfigId: string, clientScorerKey: string): string {
  return `client:${scoreConfigId}:${clientScorerKey}`;
}

/** A score column's header. A client dimension says its scores came from the customer's own code. */
export function scoreColumnLabel(
  column: Pick<ExperimentScoreSummary, "name" | "clientScorerKey">,
  t: TranslateFn,
): I18nText {
  return column.clientScorerKey === null
    ? raw(column.name)
    : t("experimentsAtScale.clientScore", { score: column.name });
}

export interface ExperimentEvidence {
  completedSlots: number;
  totalSlots: number;
  cost: number | null;
  /** A task or judge call had no price, so `cost` is a lower bound (or unknown). */
  costIncomplete: boolean;
  scores: ExperimentScoreSummary[];
}

/** How a run's cost reads: an unpriced call makes the total a floor, and a
 *  floor of zero says nothing, so it reads as unknown rather than $0. */
export type ExperimentCostDisplay =
  | { kind: "none" }
  | { kind: "exact"; value: number }
  | { kind: "atLeast"; value: number }
  | { kind: "unknown" };

export function experimentCostDisplay(
  cost: number | null | undefined,
  incomplete: boolean | null | undefined,
): ExperimentCostDisplay {
  if (!incomplete) {
    return cost === null || cost === undefined ? { kind: "none" } : { kind: "exact", value: cost };
  }
  return cost !== null && cost !== undefined && cost > 0
    ? { kind: "atLeast", value: cost }
    : { kind: "unknown" };
}

/** The cost text the experiment list and detail page both show. */
export function experimentCostText(
  cost: number | null | undefined,
  incomplete: boolean | null | undefined,
  t: TranslateFn,
): I18nText {
  const display = experimentCostDisplay(cost, incomplete);
  switch (display.kind) {
    case "none":
      return raw("—");
    case "exact":
      return raw(`$${display.value.toFixed(4)}`);
    case "atLeast":
      return t("aiObservability.experiments.costAtLeast", {
        cost: `$${display.value.toFixed(4)}`,
      });
    case "unknown":
      return t("aiObservability.experiments.costUnknown");
  }
}

export interface ExperimentDatasetGroup {
  datasetId: string;
  datasetName: string;
  experiments: LlmExperiment[];
}

type ScoreIdentity = Pick<
  ExperimentScoreSummary,
  | "key"
  | "name"
  | "scoreConfigId"
  | "clientScorerKey"
  | "sampleCount"
  | "errorCount"
  | "pendingCount"
>;

/** The browse table's shape of one type-aware aggregate; null when there is none yet. */
function scoreSummary(
  identity: ScoreIdentity,
  aggregate: Record<string, unknown> | null,
): ExperimentScoreSummary | null {
  if (aggregate?.kind === "numeric") {
    return { ...identity, kind: "numeric", value: Number(aggregate.mean ?? 0) };
  }
  if (aggregate?.kind === "boolean") {
    return {
      ...identity,
      kind: "boolean",
      trueCount: Number(aggregate.trueCount ?? aggregate.true_count ?? 0),
      falseCount: Number(aggregate.falseCount ?? aggregate.false_count ?? 0),
    };
  }
  if (aggregate?.kind === "categorical") {
    const counts = (aggregate.counts ?? {}) as Record<string, number>;
    return {
      ...identity,
      kind: "categorical",
      values: Object.entries(counts).map(([value, count]) => ({ value, count: Number(count) })),
    };
  }
  return null;
}

function clientScoreSummary(summary: ExperimentClientScoreSummary): ExperimentScoreSummary | null {
  return scoreSummary(
    {
      key: clientScoreKey(summary.scoreConfigId, summary.clientScorerKey),
      name: summary.scoreConfigName || summary.clientScorerKey,
      scoreConfigId: summary.scoreConfigId || null,
      clientScorerKey: summary.clientScorerKey,
      sampleCount: summary.sampleCount,
      errorCount: 0,
      pendingCount: 0,
    },
    summary.value,
  );
}

/** The row's `includeSummary` fields already carry the per-scorer aggregate; this only reshapes. */
export function experimentEvidence(experiment: LlmExperiment): ExperimentEvidence {
  const platform = (experiment.scoreSummaries ?? []).map((summary) => {
    const name = summary.scoreConfigName || summary.name;
    return scoreSummary(
      {
        key: name,
        name,
        scoreConfigId: summary.scoreConfigId,
        clientScorerKey: null,
        sampleCount: summary.sampleCount,
        errorCount: summary.errorCount,
        pendingCount: summary.pendingCount,
      },
      summary.value,
    );
  });
  const client = (experiment.clientScoreSummaries ?? []).map(clientScoreSummary);
  const scores = [...platform, ...client].filter(
    (score): score is ExperimentScoreSummary => score !== null,
  );

  return {
    completedSlots: experiment.executionProgress?.completed ?? 0,
    totalSlots: experiment.executionProgress?.total ?? 0,
    cost: experiment.aggregateSummary?.totalCost ?? null,
    costIncomplete: experiment.aggregateSummary?.costIncomplete ?? false,
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
