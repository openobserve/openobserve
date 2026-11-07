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
import type { ExperimentScoreSummary, LlmExperiment } from "@/services/llm-experiments.service";
import type { ScoreConfig } from "@/services/online-evals.service";
import {
  ciGroupKey,
  ciGroups,
  compareToBaseline,
  foldReruns,
  gitMeta,
  noiseBand,
  orientedDelta,
  scorePolicies,
  scorePolicy,
  scoreSpreadLabel,
  scoreTrend,
  signedPoints,
  sortByRegressions,
  trendScores,
} from "./experimentScale";
import { makeExperiment } from "./experimentTestFixtures";

const summary = (name: string, value: Record<string, unknown>): ExperimentScoreSummary => ({
  scorerId: `scorer-${name}`,
  scorerVersion: 1,
  name,
  scoreConfigId: `cfg-${name}`,
  scoreConfigName: null,
  scoreConfigVersion: 1,
  sampleCount: 56,
  errorCount: 0,
  pendingCount: 0,
  noReferenceCount: 0,
  noTraceCount: 0,
  skippedCount: 0,
  value,
});
const bool = (trueCount: number, falseCount: number) =>
  summary("disclosure", { kind: "boolean", trueCount, falseCount });
const severity = (counts: Record<string, number>) =>
  summary("severity", { kind: "categorical", counts });
const quality = (mean: number) => summary("quality", { kind: "numeric", mean });

const git = (commit: string, extra: Record<string, unknown> = {}) => ({
  "git.commit": commit,
  ...extra,
});
const run = (id: string, createdAt: number, scores: ExperimentScoreSummary[], rest = {}) =>
  makeExperiment({ id, name: id, createdAt, scoreSummaries: scores, ...rest });

const policies = scorePolicies([
  // No disclosure is the healthy answer, so a rising "% true" is a regression.
  {
    entityId: "cfg-disclosure",
    dataType: "boolean",
    healthyThreshold: { healthy_value: false },
  },
  {
    entityId: "cfg-severity",
    dataType: "categorical",
    healthyThreshold: { healthy_categories: ["none"] },
  },
  {
    entityId: "cfg-quality",
    dataType: "numeric",
    numericRange: { min: 0, max: 1 },
    healthyThreshold: { direction: "gte", value: 0.7 },
  },
] as unknown as ScoreConfig[]);

// The design's numbers: 17 of 56 baseline answers leak, 23 of 56 on the PR.
const baseline = run("main-9f2e1a0", 1, [bool(17, 39), severity({ none: 39, full: 17 })], {
  isBaseline: true,
});

describe("score policy", () => {
  it("reads each data type the way score_policy.rs does, and nothing without a threshold", () => {
    expect(
      scorePolicy({ dataType: "numeric", healthyThreshold: { operator: "lte" } } as any),
    ).toEqual({ kind: "numeric", direction: "lte", span: null });
    expect(
      scorePolicy({ dataType: "numeric", healthyThreshold: { direction: "up" } } as any),
    ).toBeNull();
    expect(scorePolicy({ dataType: "boolean", healthyThreshold: {} } as any)).toBeNull();
    expect(scorePolicy({ dataType: "categorical" } as any)).toBeNull();
  });

  it("orients numeric moves by range, else by the baseline, and a move off zero is a full change", () => {
    const ranged = { kind: "numeric", direction: "gte", span: 2 } as const;
    expect(orientedDelta(ranged, 1, 0.8)).toBeCloseTo(-0.1);
    const lower = { kind: "numeric", direction: "lte", span: null } as const;
    expect(orientedDelta(lower, 2, 2.05)).toBeCloseTo(-0.025);
    expect(orientedDelta(lower, 0, 0.01)).toBe(-1);
    expect(noiseBand(ranged, 1)).toEqual([0.9, 1.1]);
  });
});

describe("compare to baseline", () => {
  it("calls a healthy-share drop past 5 points a regression and names the score", () => {
    const pr = run("gh-pr181-a41d9e2", 2, [bool(23, 33), severity({ none: 38, full: 18 })]);
    const result = compareToBaseline(pr, baseline, policies)!;

    expect(result.outcome).toBe("regressed");
    expect(result.headline.name).toBe("disclosure");
    expect(signedPoints(result.headline.delta)).toBe("−10.7");
    expect(result.deltas.get("severity")?.outcome).toBe("unchanged");
  });

  it("is improved only when nothing regressed, and latency or cost never vote", () => {
    const better = run("better", 2, [bool(10, 46), severity({ none: 39, full: 17 })], {
      aggregateSummary: { p50LatencyMs: 99_999, totalCost: 50 } as any,
    });
    const result = compareToBaseline(better, baseline, policies)!;
    expect(result.outcome).toBe("improved");
    expect(signedPoints(result.headline.delta)).toBe("+12.5");
  });

  it("reads an exact 5-point move the same for numeric means and boolean shares, despite float noise", () => {
    const outcome = (base: ExperimentScoreSummary, candidate: ExperimentScoreSummary) =>
      compareToBaseline(run("pr", 2, [candidate]), run("base", 1, [base]), policies)!.outcome;
    // Same rule as comparison.rs `classify_delta`: strict threshold after float noise is removed.
    expect(outcome(quality(0.7999999999999999), quality(0.75))).toBe("unchanged");
    expect(outcome(quality(0.8), quality(0.75))).toBe("unchanged");
    expect(outcome(quality(0.8), quality(0.85))).toBe("unchanged");
    // 16/20 healthy (no disclosure) to 15/20.
    expect(outcome(bool(4, 16), bool(5, 15))).toBe("unchanged");
    expect(outcome(quality(0.8), quality(0.749))).toBe("regressed");
  });

  it("gives no outcome to the baseline, a live run, or a run with no policy-backed score", () => {
    expect(compareToBaseline(baseline, baseline, policies)).toBeNull();
    expect(
      compareToBaseline(run("live", 2, [bool(1, 0)], { status: "running" }), baseline, policies),
    ).toBeNull();
    expect(compareToBaseline(run("q", 2, [quality(0.4)]), baseline, policies)).toBeNull();
    expect(compareToBaseline(run("x", 2, [bool(23, 33)]), null, policies)).toBeNull();
  });
});

describe("re-runs and CI groups", () => {
  const rerun = (id: string, createdAt: number, trueCount: number) =>
    makeExperiment({
      id,
      name: "gh-pr172-303cfc8",
      createdAt,
      metadata: git("303cfc8", { "git.pr": 172, "git.branch": "feat/x" }),
      scoreSummaries: [bool(trueCount, 56 - trueCount)],
    });

  it("folds one name on one commit into its latest run, never the baseline or a run with no commit", () => {
    const folds = foldReruns([
      rerun("c", 3, 16),
      rerun("b", 2, 18),
      makeExperiment({
        id: "base",
        name: "gh-pr172-303cfc8",
        metadata: git("303cfc8"),
        isBaseline: true,
      }),
      makeExperiment({ id: "loose-1", name: "manual" }),
      makeExperiment({ id: "loose-2", name: "manual" }),
    ]);
    expect(folds.map((fold) => [fold.latest.id, fold.earlier.map(({ id }) => id)])).toEqual([
      ["c", ["b"]],
      ["base", []],
      ["loose-1", []],
      ["loose-2", []],
    ]);
    expect(scoreSpreadLabel([rerun("c", 3, 15), rerun("b", 2, 18)], "disclosure")).toBe("27–32%");
  });

  it("groups by PR, falls back to the branch, and puts runs without metadata in one group", () => {
    expect(ciGroupKey(rerun("c", 3, 16), "pr")).toBe("pr:172");
    expect(ciGroupKey(makeExperiment({ metadata: { git: { branch: "main" } } }), "pr")).toBe(
      "branch:main",
    );
    expect(ciGroupKey(makeExperiment(), "commit")).toBe("none");
    expect(ciGroupKey(rerun("c", 3, 16), "none")).toBeNull();
    expect(gitMeta(makeExperiment({ metadata: { "git.pr": 0 } }), "pr")).toBe("0");
  });

  it("sorts groups by their worst run under regressions first, and keeps the catch-all last otherwise", () => {
    const runs = [
      run("pr181", 5, [bool(23, 33)], { metadata: git("a41d9e2", { "git.pr": 181 }) }),
      run("pr169", 4, [bool(10, 46)], { metadata: git("7c01b55", { "git.pr": 169 }) }),
      run("hand", 6, [bool(17, 39)]),
      { ...baseline, metadata: git("9f2e1a0", { "git.branch": "main" }) } as LlmExperiment,
    ];
    const comparisons = new Map(runs.map((r) => [r.id, compareToBaseline(r, runs[3], policies)]));
    const folds = foldReruns(runs);

    const byRegression = ciGroups(folds, "pr", "regressions", comparisons);
    expect(byRegression.map((g) => g.key)).toEqual(["pr:181", "none", "pr:169", "branch:main"]);
    expect(byRegression[0]).toMatchObject({
      kind: "pr",
      value: "181",
      regressed: 1,
      commit: "a41d9e2",
    });

    expect(ciGroups(folds, "pr", "recent", comparisons).map((g) => g.key)).toEqual([
      "pr:181",
      "pr:169",
      "branch:main",
      "none",
    ]);
    expect(sortByRegressions(folds, comparisons).map((f) => f.latest.id)).toEqual([
      "main-9f2e1a0",
      "pr181",
      "hand",
      "pr169",
    ]);
  });
});

describe("trend", () => {
  it("plots one point per completed run, oldest first, against a 5-point band", () => {
    const runs = [
      run("late", 3, [bool(10, 46)]),
      run("early", 2, [bool(23, 33)]),
      run("live", 4, [bool(1, 1)], { status: "running" }),
      baseline,
    ];
    const trend = scoreTrend(runs, baseline, "disclosure", policies)!;

    expect(trend.points.map((p) => [p.id, p.outcome])).toEqual([
      ["main-9f2e1a0", "unchanged"],
      ["early", "regressed"],
      ["late", "improved"],
    ]);
    expect(trend.share).toBe(true);
    expect(trend.band[1] - trend.band[0]).toBeCloseTo(0.1);
    expect([trend.regressed, trend.improved]).toEqual([1, 1]);
    expect(trendScores(baseline, policies)).toEqual([
      { name: "disclosure", share: true },
      { name: "severity", share: true },
    ]);
  });
});
