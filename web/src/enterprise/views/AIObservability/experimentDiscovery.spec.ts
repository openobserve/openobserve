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

import { describe, expect, it } from "vitest";
import {
  clientScoreKey,
  comparisonEligibility,
  experimentCostText,
  experimentEvidence,
  groupExperiments,
  scoreColumnLabel,
} from "./experimentDiscovery";
import type { TranslateFn } from "@/types/i18n";
import { makeExperiment } from "./experimentTestFixtures";

const experiment = (id: string, datasetId: string, createdAt: number) =>
  makeExperiment({ id, name: id, datasetId, createdAt });

describe("experiment discovery", () => {
  it("reads cost straight off the row's aggregate summary", () => {
    const row = makeExperiment({
      aggregateSummary: {
        p50LatencyMs: 4511,
        totalCost: 0.118156603,
        taskCost: 0.040630363,
        scoringCost: 0.07752624,
        costIncomplete: false,
        incomplete: false,
        incompleteTaskSlots: 0,
        incompleteScoreDimensions: 0,
        errorTaskSlots: 0,
      },
    });
    expect(experimentEvidence(row).cost).toBe(0.118156603);
  });

  it("groups by dataset, keeps filters independent, and pins the baseline first", () => {
    const rows = [
      experiment("new", "dataset-a", 2),
      makeExperiment({
        id: "old",
        name: "old",
        datasetId: "dataset-a",
        createdAt: 1,
        isBaseline: true,
      }),
      experiment("other", "dataset-b", 3),
    ];
    const groups = groupExperiments(rows, new Map([["dataset-a", "Dataset A"]]), "dataset-a", "");

    expect(groups).toHaveLength(1);
    expect(groups[0].datasetName).toBe("Dataset A");
    expect(groups[0].experiments.map(({ id }) => id)).toEqual(["old", "new"]);
    expect(groupExperiments(rows, new Map(), "", "oth")[0].experiments[0].id).toBe("other");
  });

  it("reports why cross-dataset comparison is unavailable", () => {
    expect(comparisonEligibility([experiment("a", "one", 1), experiment("b", "two", 2)])).toEqual({
      eligible: false,
      reason: "different_dataset",
    });
    expect(
      comparisonEligibility([experiment("a", "one", 1), experiment("b", "one", 2)]).eligible,
    ).toBe(true);
  });

  it("reshapes the row's type-aware score summaries for the browse table", () => {
    const row = makeExperiment({
      executionProgress: { completed: 1, total: 2, skipped: 0 },
      scoreSummaries: [
        {
          scorerId: "s-quality",
          scorerVersion: 1,
          name: "quality",
          scoreConfigId: null,
          scoreConfigName: null,
          scoreConfigVersion: null,
          sampleCount: 2,
          errorCount: 0,
          pendingCount: 0,
          noReferenceCount: 0,
          noTraceCount: 0,
          skippedCount: 0,
          value: { kind: "numeric", mean: 0.75 },
        },
        {
          scorerId: "s-approved",
          scorerVersion: 1,
          name: "approved",
          scoreConfigId: null,
          scoreConfigName: null,
          scoreConfigVersion: null,
          sampleCount: 2,
          errorCount: 0,
          pendingCount: 0,
          noReferenceCount: 0,
          noTraceCount: 0,
          skippedCount: 0,
          value: { kind: "boolean", trueCount: 1, falseCount: 1 },
        },
        {
          scorerId: "s-label",
          scorerVersion: 1,
          name: "label",
          scoreConfigId: null,
          scoreConfigName: null,
          scoreConfigVersion: null,
          sampleCount: 3,
          errorCount: 0,
          pendingCount: 0,
          noReferenceCount: 0,
          noTraceCount: 0,
          skippedCount: 0,
          value: { kind: "categorical", counts: { good: 2, bad: 1 } },
        },
      ],
    });

    expect(experimentEvidence(row)).toEqual({
      completedSlots: 1,
      totalSlots: 2,
      cost: null,
      costIncomplete: false,
      scores: [
        {
          key: "quality",
          scoreConfigId: null,
          clientScorerKey: null,
          name: "quality",
          kind: "numeric",
          value: 0.75,
          sampleCount: 2,
          errorCount: 0,
          pendingCount: 0,
        },
        {
          key: "approved",
          scoreConfigId: null,
          clientScorerKey: null,
          name: "approved",
          kind: "boolean",
          trueCount: 1,
          falseCount: 1,
          sampleCount: 2,
          errorCount: 0,
          pendingCount: 0,
        },
        {
          key: "label",
          scoreConfigId: null,
          clientScorerKey: null,
          name: "label",
          kind: "categorical",
          values: [
            { value: "good", count: 2 },
            { value: "bad", count: 1 },
          ],
          sampleCount: 3,
          errorCount: 0,
          pendingCount: 0,
        },
      ],
    });
  });

  // An SDK run that scores in its own process pins no Scorer.
  it("gives each client-reported dimension its own column, keyed by Score Config and client key", () => {
    const client = (clientScorerKey: string, mean: number) => ({
      scoreConfigId: "cfg-quality",
      scoreConfigName: "quality",
      clientScorerKey,
      sampleCount: 4,
      value: { kind: "numeric", mean },
    });
    const row = makeExperiment({
      scoreSummaries: [],
      clientScoreSummaries: [client("exact", 0.5), client("fuzzy", 0.75)],
    });

    const scores = experimentEvidence(row).scores;
    expect(scores.map(({ key, name, clientScorerKey }) => [key, name, clientScorerKey])).toEqual([
      [clientScoreKey("cfg-quality", "exact"), "quality", "exact"],
      [clientScoreKey("cfg-quality", "fuzzy"), "quality", "fuzzy"],
    ]);
    expect(scores[0]).toMatchObject({ kind: "numeric", value: 0.5, scoreConfigId: "cfg-quality" });

    const t = ((key: string, named?: { score?: string }) =>
      `${key}:${named?.score}`) as unknown as TranslateFn;
    expect(scoreColumnLabel(scores[0], t)).toBe("experimentsAtScale.clientScore:quality");
    expect(scoreColumnLabel({ name: "quality", clientScorerKey: null }, t)).toBe("quality");
  });

  it("reads an incomplete cost as a floor, and a zero floor as unknown rather than free", () => {
    const t = ((key: string, named?: { cost?: string }) =>
      named?.cost ? `${key}:${named.cost}` : key) as unknown as TranslateFn;
    expect(experimentCostText(null, false, t)).toBe("—");
    expect(experimentCostText(0, false, t)).toBe("$0.0000");
    expect(experimentCostText(0.12, false, t)).toBe("$0.1200");
    expect(experimentCostText(0.12, true, t)).toBe(
      "aiObservability.experiments.costAtLeast:$0.1200",
    );
    expect(experimentCostText(0, true, t)).toBe("aiObservability.experiments.costUnknown");
    expect(experimentCostText(null, true, t)).toBe("aiObservability.experiments.costUnknown");
  });
});
