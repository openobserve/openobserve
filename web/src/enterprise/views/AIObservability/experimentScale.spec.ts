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
import type {
  ExperimentComparison,
  ExperimentScoreSummary,
  LlmExperiment,
} from "@/services/llm-experiments.service";
import type { ScoreConfig } from "@/services/online-evals.service";
import {
  ciGroupKey,
  ciGroups,
  compareToBaseline,
  foldReruns,
  gitMeta,
  noiseBand,
  orientedDelta,
  sameCases,
  scorePolicies,
  scorePolicy,
  scoreSpread,
  scoreTrend,
  sharedCaseComparison,
  signedDelta,
  signedPoints,
  sortByRegressions,
  tallyRuns,
  trendScores,
} from "./experimentScale";
import { clientScoreKey } from "./experimentDiscovery";
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

  // A CI job that scores in its own process reports client Scores only.
  it("judges client-reported dimensions by their Score Config's policy, pairing on config and client key", () => {
    const client = (clientScorerKey: string, mean: number) => ({
      scoreConfigId: "cfg-quality",
      scoreConfigName: "quality",
      clientScorerKey,
      sampleCount: 10,
      value: { kind: "numeric", mean },
    });
    const base = run("sdk-base", 1, [], {
      isBaseline: true,
      clientScoreSummaries: [client("ci_judge", 0.8), client("other_judge", 0.8)],
    });
    const pr = run("sdk-pr", 2, [quality(0.8)], {
      clientScoreSummaries: [client("ci_judge", 0.6), client("new_judge", 0.1)],
    });
    const result = compareToBaseline(pr, base, policies)!;

    const key = clientScoreKey("cfg-quality", "ci_judge");
    expect(result.outcome).toBe("regressed");
    expect(result.headline).toMatchObject({ key, name: "quality", clientScorerKey: "ci_judge" });
    expect(signedPoints(result.headline.delta)).toBe("−20.0");
    expect([...result.deltas.keys()]).toEqual([key]);
  });

  describe("a run on other cases than the baseline", () => {
    const base = run("qa2-base", 1, [quality(0.8)], { isBaseline: true, datasetVersion: 10 });
    const dsv11 = run("qa2-dsv11", 2, [quality(0.727)], { datasetVersion: 11 });
    const dimension = (overrides: Record<string, unknown>) => ({
      id: "score:quality",
      name: "quality",
      kind: "score",
      gating: true,
      comparableRowCount: 10,
      orientedDelta: 0,
      delta: 0,
      ...overrides,
    });
    const compared = (dimensions: Record<string, unknown>[]) =>
      sharedCaseComparison({
        counts: { commonRows: 10, new: 1, missing: 0 },
        dimensions,
      } as unknown as ExperimentComparison);
    const unchanged = compared([
      dimension({}),
      // Neither cost, a descriptive score, nor a one-sided one votes.
      dimension({ id: "cost", name: "cost", kind: "cost", orientedDelta: -0.5, delta: 1 }),
      dimension({ id: "score:tone", name: "tone", gating: false, orientedDelta: null }),
      dimension({ id: "score:leak", name: "leak", comparableRowCount: 0, orientedDelta: null }),
    ]);

    it("judges it over the shared cases only, and says how many were left out", () => {
      expect(sameCases(dsv11, base)).toBe(false);
      expect(sameCases({ ...dsv11, datasetVersion: 10 }, base)).toBe(true);
      expect(sameCases({ ...base, id: "f", datasetFilter: { tags: ["x"] } }, base)).toBe(false);
      // Its means include the new failing case, so alone they would read as a regression.
      expect(
        compareToBaseline({ ...dsv11, datasetVersion: 10 }, base, policies)!.headline,
      ).toMatchObject({ name: "quality", outcome: "regressed" });

      expect([...unchanged.scores.keys()]).toEqual(["quality"]);
      const result = compareToBaseline(dsv11, base, policies, unchanged)!;
      expect(result.outcome).toBe("unchanged");
      expect(result.cases).toEqual({ shared: 10, excluded: 1 });
      // A same-case run keeps the summary path and has nothing left out.
      expect(compareToBaseline({ ...dsv11, datasetVersion: 10 }, base, policies)!.cases).toBeNull();
    });

    it("files Compare's client and platform dimensions under the list's own columns", () => {
      const mapped = compared([
        dimension({
          id: "score:a",
          name: "scorer-quality · v1",
          scoreConfigId: "cfg-quality",
          scoreConfigName: "quality",
        }),
        dimension({
          id: "score:b",
          name: "ci_judge · client",
          scoreConfigId: "cfg-quality",
          scoreConfigName: "quality",
          orientedDelta: -0.2,
          delta: -0.2,
        }),
      ]);
      const key = clientScoreKey("cfg-quality", "ci_judge");
      expect([...mapped.scores.keys()]).toEqual(["quality", key]);
      expect(mapped.scores.get(key)).toMatchObject({
        name: "quality",
        clientScorerKey: "ci_judge",
      });
      const result = compareToBaseline(dsv11, base, policies, mapped)!;
      expect(result.outcome).toBe("regressed");
      expect(result.headline.key).toBe(key);
    });

    it("has no verdict until Compare answers, and takes a regression from it", () => {
      expect(compareToBaseline(dsv11, base, policies)).toBeNull();
      const regressed = compared([dimension({ orientedDelta: -0.1, delta: -0.1 })]);
      const result = compareToBaseline(dsv11, base, policies, regressed)!;
      expect(result.outcome).toBe("regressed");
      expect(signedPoints(result.headline.delta)).toBe("−10.0");
    });

    it("plots it on the trend by its shared-case move, and leaves it out before Compare answers", () => {
      const plotted = scoreTrend(
        [base, dsv11],
        base,
        "quality",
        policies,
        new Map([[dsv11.id, unchanged]]),
      )!;
      expect(plotted.points.map((p) => [p.id, p.value, p.outcome])).toEqual([
        ["qa2-base", 0.8, "unchanged"],
        ["qa2-dsv11", 0.8, "unchanged"],
      ]);
      expect(plotted.regressed).toBe(0);
      expect(
        scoreTrend([base, dsv11], base, "quality", policies, new Map())!.points.map((p) => p.id),
      ).toEqual(["qa2-base"]);
    });
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
    expect(scoreSpread([rerun("c", 3, 15), rerun("b", 2, 18)], "disclosure")).toEqual({
      count: 2,
      range: "27–32%",
    });
    // Runs that agree read as one value, not "0.800–0.800".
    expect(scoreSpread([rerun("c", 3, 16), rerun("b", 2, 16)], "disclosure")).toEqual({
      count: 2,
      range: "29%",
    });
    expect(
      scoreSpread([run("q2", 2, [quality(0.8)]), run("q1", 1, [quality(0.8)])], "quality"),
    ).toEqual({ count: 2, range: "0.800" });
  });

  it("keeps the newest completed re-run's verdict when a newer one was cancelled", () => {
    const cancelled = makeExperiment({
      ...rerun("r5", 5, 0),
      status: "cancelled",
      executionStatus: "cancelled",
      scoreSummaries: [],
    });
    const quiet = run("pr169", 6, [bool(17, 39)], { metadata: git("7c01b55", { "git.pr": 169 }) });
    const runs = [
      rerun("r1", 1, 17),
      rerun("r2", 2, 18),
      rerun("r3", 3, 16),
      rerun("r4", 4, 23),
      cancelled,
      quiet,
      baseline,
    ];
    const folds = foldReruns(runs);
    const flaky = folds[0];

    expect(flaky.latest.id).toBe("r4");
    expect(flaky.newerIncomplete?.id).toBe("r5");
    expect(flaky.earlier.map(({ id }) => id)).toEqual(["r5", "r3", "r2", "r1"]);
    // Four values in the spread, not the fold's five runs.
    expect(scoreSpread([flaky.latest, ...flaky.earlier], "disclosure")?.count).toBe(4);

    const comparisons = new Map(runs.map((r) => [r.id, compareToBaseline(r, baseline, policies)]));
    expect(signedPoints(comparisons.get(flaky.latest.id)!.headline.delta)).toBe("−10.7");
    expect(sortByRegressions(folds, comparisons).map((f) => f.latest.id)).toEqual([
      "main-9f2e1a0",
      "r4",
      "pr169",
    ]);
    const groups = ciGroups(folds, "pr", "regressions", comparisons);
    expect(groups.map((g) => g.key)).toEqual(["pr:172", "pr:169", "none"]);
    // The section counts the four settled runs and names the cancelled one.
    expect(groups[0]).toMatchObject({
      regressed: 1,
      runs: { settled: 4, incomplete: { cancelled: 1, failed: 0, inProgress: 0 } },
    });
    const trend = scoreTrend(
      folds.map((fold) => fold.latest),
      baseline,
      "disclosure",
      policies,
      new Map(),
    )!;
    expect(trend.points.find((point) => point.id === "r4")?.outcome).toBe("regressed");

    // A fold with no completed run still shows its newest.
    const [alone] = foldReruns([cancelled]);
    expect([alone.latest.id, alone.newerIncomplete]).toEqual(["r5", null]);
  });

  it("tallies settled runs apart from cancelled, failed and unfinished ones", () => {
    const at = (status: LlmExperiment["status"]) => makeExperiment({ status });
    expect(
      tallyRuns([
        at("completed"),
        at("scoring_failed"),
        at("cancelled"),
        at("execution_failed"),
        at("scoring"),
        at("pending"),
      ]),
    ).toEqual({ settled: 2, incomplete: { cancelled: 1, failed: 1, inProgress: 2 } });
  });

  it("lets a newer scoring_failed re-run stand for its fold", () => {
    const partial = makeExperiment({ ...rerun("r3", 3, 10), status: "scoring_failed" });
    const [fold] = foldReruns([rerun("r1", 1, 17), partial]);
    expect([fold.latest.id, fold.newerIncomplete]).toEqual(["r3", null]);
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
    const trend = scoreTrend(runs, baseline, "disclosure", policies, new Map())!;

    expect(trend.points.map((p) => [p.id, p.outcome])).toEqual([
      ["main-9f2e1a0", "unchanged"],
      ["early", "regressed"],
      ["late", "improved"],
    ]);
    expect(trend.share).toBe(true);
    expect(trend.band[1] - trend.band[0]).toBeCloseTo(0.1);
    expect([trend.regressed, trend.improved]).toEqual([1, 1]);
    expect(trendScores(baseline, policies)).toEqual([
      { key: "disclosure", name: "disclosure", clientScorerKey: null, share: true },
      { key: "severity", name: "severity", clientScorerKey: null, share: true },
    ]);
  });
});

// A Scorer that errored on some rows must not blank the verdict on other scores.
describe("partly failed scoring", () => {
  const failedSeverity = { ...severity({ none: 20, full: 30 }), errorCount: 5 };
  const partial = run("partial", 2, [bool(10, 46), failedSeverity], { status: "scoring_failed" });

  it("votes with the clean scores and leaves the errored one out", () => {
    const result = compareToBaseline(partial, baseline, policies)!;
    expect(result.outcome).toBe("improved");
    expect([...result.deltas.keys()]).toEqual(["disclosure"]);
    expect(compareToBaseline({ ...partial, status: "execution_failed" }, baseline, policies)).toBe(
      null,
    );
  });

  it("leaves the errored score out of a shared-case verdict too", () => {
    const move = (key: string, delta: number) => ({
      key,
      name: key,
      clientScorerKey: null,
      delta,
      change: delta,
      scoreConfigId: `cfg-${key}`,
    });
    const shared = {
      shared: 40,
      excluded: 2,
      scores: new Map([
        ["disclosure", move("disclosure", 0.1)],
        ["severity", move("severity", -0.3)],
      ]),
    };
    const other = { ...partial, datasetVersion: baseline.datasetVersion + 1 };
    const result = compareToBaseline(other, baseline, policies, shared)!;
    expect(result.outcome).toBe("improved");
    expect([...result.deltas.keys()]).toEqual(["disclosure"]);
  });

  it("plots the run on its clean scores only", () => {
    const points = (key: string) =>
      scoreTrend([partial], baseline, key, policies, new Map())!.points.map(({ id }) => id);
    expect(points("disclosure")).toEqual(["partial"]);
    expect(points("severity")).toEqual([]);
  });
});

// An unranged numeric score moves relative to its baseline.
describe("delta units", () => {
  it("prints an unranged numeric move as a percent of the baseline, and a ranged one as points", () => {
    const latency = (mean: number) => summary("latency", { kind: "numeric", mean });
    const unranged = scorePolicies([
      { entityId: "cfg-latency", dataType: "numeric", healthyThreshold: { direction: "lte" } },
    ] as unknown as ScoreConfig[]);
    const relative = compareToBaseline(
      run("fast", 2, [latency(0)]),
      run("slow", 1, [latency(100)]),
      unranged,
    )!;
    expect(relative.headline).toMatchObject({ relative: true, outcome: "improved" });
    expect(signedDelta(relative.headline)).toBe("+100.0%");

    const ranged = compareToBaseline(
      run("pr", 2, [quality(0.7)]),
      run("base", 1, [quality(0.8)]),
      policies,
    )!;
    expect(ranged.headline.relative).toBe(false);
    expect(signedDelta(ranged.headline)).toBe("−10.0");
  });
});
