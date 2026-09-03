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

import { beforeEach, describe, expect, it } from "vitest";
import type { ExperimentDetail } from "@/services/llm-experiments.service";
import {
  comparisonEligibility,
  experimentEvidence,
  fetchExperimentDetails,
  groupExperiments,
  readExperimentBaselines,
  writeExperimentBaselines,
} from "./experimentDiscovery";
import { makeExperiment, makeExperimentDetail } from "./experimentTestFixtures";

const experiment = (id: string, datasetId: string, createdAt: number) =>
  makeExperiment({ id, name: id, datasetId, createdAt });

beforeEach(() => localStorage.clear());

describe("experiment discovery", () => {
  it("uses the full-run cost when executions contain only the first page", () => {
    const detail = makeExperimentDetail(makeExperiment(), {
      results: {
        executions: [{ cost: 0.032112106 } as any],
        scores: [],
        pagination: { page: 1, pageSize: 50, totalSlots: 56, hasMore: true },
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
      },
    });
    expect(experimentEvidence(detail).cost).toBe(detail.results.aggregateSummary?.totalCost);
  });

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
      reason: "different_dataset",
    });
    expect(
      comparisonEligibility([experiment("a", "one", 1), experiment("b", "one", 2)]).eligible,
    ).toBe(true);
  });

  it("summarizes numeric, boolean, categorical, mixed, and missing score values", () => {
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
          { name: "quality", value_numeric: null },
          { name: "approved", value_boolean: true },
          { name: "approved", value_boolean: false },
          { name: "approved" },
          { name: "label", value_categorical: "good" },
          { name: "label", value_categorical: "good" },
          { name: "label", value_categorical: "bad" },
          { name: "mixed", value_numeric: 0.25 },
          { name: "mixed", value_categorical: "review" },
          { name: "missing", value_numeric: null, value_boolean: null, value_categorical: null },
        ],
      },
    } satisfies ExperimentDetail;

    expect(experimentEvidence(detail)).toEqual({
      completedSlots: 1,
      totalSlots: 2,
      cost: null,
      scores: [
        { name: "quality", kind: "numeric", value: 0.75, sampleCount: 2 },
        { name: "mixed", kind: "numeric", value: 0.25, sampleCount: 1 },
        {
          name: "approved",
          kind: "boolean",
          trueCount: 1,
          falseCount: 1,
          sampleCount: 2,
        },
        {
          name: "label",
          kind: "categorical",
          values: [
            { value: "good", count: 2 },
            { value: "bad", count: 1 },
          ],
          sampleCount: 3,
        },
        {
          name: "mixed",
          kind: "categorical",
          values: [{ value: "review", count: 1 }],
          sampleCount: 1,
        },
      ],
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
