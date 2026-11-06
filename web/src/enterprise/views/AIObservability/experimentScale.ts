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

// The Experiments list at scale: runs grouped by their CI metadata, re-runs
// folded, and each run judged against its dataset's baseline by the rule
// Compare uses (score_policy.rs + comparison.rs), from the list's own summaries.

import type { LlmExperiment } from "@/services/llm-experiments.service";
import type { ScoreConfig } from "@/services/online-evals.service";
import {
  dataTypeOf,
  entityId,
  valueOf,
} from "@/enterprise/components/onlineEvals/utils/evalEntity";
import { experimentEvidence, type ExperimentScoreSummary } from "./experimentDiscovery";

/** DEFAULT_COMPARISON_THRESHOLD in comparison.rs: 5 points of healthy share. */
export const COMPARISON_THRESHOLD = 0.05;

export type ExperimentGroupBy = "pr" | "branch" | "commit" | "none";
export type ExperimentGroupSort = "recent" | "regressions";
export type BaselineOutcome = "regressed" | "improved" | "unchanged";

export const NO_CI_GROUP = "none";

export function parseGroupBy(value: unknown): ExperimentGroupBy {
  return value === "pr" || value === "branch" || value === "commit" ? value : "none";
}

export function parseGroupSort(value: unknown): ExperimentGroupSort {
  return value === "regressions" ? "regressions" : "recent";
}

/** The CI action writes flat dotted keys (`git.pr`); a nested `git` object is read too. */
export function gitMeta(run: LlmExperiment, key: "pr" | "branch" | "commit"): string | null {
  const metadata = (run.metadata ?? {}) as Record<string, any>;
  const value = metadata[`git.${key}`] ?? metadata.git?.[key];
  return value === null || value === undefined || value === "" ? null : String(value);
}

/** A Score Config's health policy, parsed the way score_policy.rs parses it. */
export type ScorePolicy =
  | { kind: "numeric"; direction: "gte" | "lte"; span: number | null }
  | { kind: "boolean"; healthy: boolean }
  | { kind: "categorical"; healthy: string[] };

export function scorePolicy(config: ScoreConfig): ScorePolicy | null {
  const ht = valueOf<any>(config, "healthyThreshold", "healthy_threshold");
  if (!ht) return null;
  const type = dataTypeOf(config);
  if (type === "numeric") {
    const direction = ht.direction ?? ht.operator;
    if (direction !== "gte" && direction !== "lte") return null;
    const range = valueOf<any>(config, "numericRange", "numeric_range");
    const ranged =
      typeof range?.min === "number" && typeof range?.max === "number" && range.max > range.min;
    return { kind: "numeric", direction, span: ranged ? range.max - range.min : null };
  }
  if (type === "boolean") {
    const healthy = ht.healthy_value ?? ht.healthyValue;
    return typeof healthy === "boolean" ? { kind: "boolean", healthy } : null;
  }
  const categories = ht.healthy_categories ?? ht.healthyCategories;
  return Array.isArray(categories)
    ? { kind: "categorical", healthy: categories.filter((c) => typeof c === "string") }
    : null;
}

// ponytail: keyed by entity only, so a run pinned to an older config version is
// judged by the current policy; Compare pairs by version. Key by version if
// policies start changing under live datasets.
export function scorePolicies(configs: ScoreConfig[]): Map<string, ScorePolicy> {
  const policies = new Map<string, ScorePolicy>();
  for (const config of configs) {
    const policy = scorePolicy(config);
    if (policy) policies.set(entityId(config), policy);
  }
  return policies;
}

/** The scalar Compare compares in: healthy share (0–1) for boolean and categorical, the mean for numeric. */
export function scoreMeasure(score: ExperimentScoreSummary, policy: ScorePolicy): number | null {
  if (policy.kind === "numeric") {
    return score.kind === "numeric" && score.sampleCount > 0 && Number.isFinite(score.value)
      ? score.value
      : null;
  }
  if (policy.kind === "boolean" && score.kind === "boolean") {
    const total = score.trueCount + score.falseCount;
    return total ? (policy.healthy ? score.trueCount : score.falseCount) / total : null;
  }
  if (policy.kind === "categorical" && score.kind === "categorical") {
    const total = score.values.reduce((sum, { count }) => sum + count, 0);
    const healthy = score.values
      .filter(({ value }) => policy.healthy.includes(value))
      .reduce((sum, { count }) => sum + count, 0);
    return total ? healthy / total : null;
  }
  return null;
}

/** Change in the better direction as a fraction, so one threshold fits every score. */
export function orientedDelta(policy: ScorePolicy, baseline: number, candidate: number): number {
  if (policy.kind !== "numeric") return candidate - baseline;
  const raw = policy.direction === "gte" ? candidate - baseline : baseline - candidate;
  if (policy.span) return raw / policy.span;
  // baseline_relative_delta: any move away from a zero baseline is one full change.
  if (raw === 0) return 0;
  return baseline === 0 ? Math.sign(raw) : raw / Math.abs(baseline);
}

/** The values a run can take and still be within noise: the threshold in the score's own units. */
export function noiseBand(policy: ScorePolicy, baseline: number): [number, number] {
  const scale = policy.kind === "numeric" ? (policy.span ?? Math.abs(baseline)) : 1;
  const half = COMPARISON_THRESHOLD * scale;
  return [baseline - half, baseline + half];
}

/**
 * Float noise is removed before the strict threshold test, so an exact
 * threshold-sized move (0.8 → 0.75) is unchanged however the subtraction
 * rounds. Compare's `classify_delta` in `comparison.rs` uses the same rule.
 */
function classify(delta: number): BaselineOutcome {
  const rounded = (Math.sign(delta) * Math.round(Math.abs(delta) * 1e9)) / 1e9;
  if (rounded < -COMPARISON_THRESHOLD) return "regressed";
  return rounded > COMPARISON_THRESHOLD ? "improved" : "unchanged";
}

export interface ScoreDelta {
  name: string;
  delta: number;
  outcome: BaselineOutcome;
}

export interface RunComparison {
  outcome: BaselineOutcome;
  deltas: Map<string, ScoreDelta>;
  /** Lowest delta; regressions-first sorts on it. */
  worst: ScoreDelta;
  /** The move the outcome is named for: the worst, or the best when improved. */
  headline: ScoreDelta;
}

function policyOf(score: ExperimentScoreSummary, policies: Map<string, ScorePolicy>) {
  return score.scoreConfigId ? (policies.get(score.scoreConfigId) ?? null) : null;
}

/**
 * Score columns only vote, as in Compare: latency and cost never count. A run
 * with no score that has a policy on both sides gets no outcome, the same as
 * Compare's inconclusive.
 */
export function compareToBaseline(
  run: LlmExperiment,
  baseline: LlmExperiment | null,
  policies: Map<string, ScorePolicy>,
): RunComparison | null {
  if (!baseline || run.id === baseline.id) return null;
  // Partial summaries of a live run would read as moves that are not there yet.
  if (run.status !== "completed" || baseline.status !== "completed") return null;
  const reference = new Map(experimentEvidence(baseline).scores.map((s) => [s.name, s]));
  const deltas = new Map<string, ScoreDelta>();
  for (const score of experimentEvidence(run).scores) {
    const other = reference.get(score.name);
    const policy = policyOf(score, policies);
    if (!other || !policy) continue;
    const candidate = scoreMeasure(score, policy);
    const base = scoreMeasure(other, policy);
    if (candidate === null || base === null) continue;
    const delta = orientedDelta(policy, base, candidate);
    deltas.set(score.name, { name: score.name, delta, outcome: classify(delta) });
  }
  if (!deltas.size) return null;
  const ranked = [...deltas.values()].sort((left, right) => left.delta - right.delta);
  const worst = ranked[0];
  const best = ranked[ranked.length - 1];
  const outcome: BaselineOutcome =
    worst.outcome === "regressed"
      ? "regressed"
      : best.outcome === "improved"
        ? "improved"
        : "unchanged";
  return { outcome, deltas, worst, headline: outcome === "improved" ? best : worst };
}

/** "−10.7" from −0.107: a fraction as signed points, with a real minus sign. */
export function signedPoints(delta: number): string {
  const points = (delta * 100).toFixed(1);
  if (Number(points) === 0) return "0.0";
  return delta > 0 ? `+${points}` : points.replace("-", "−");
}

export interface RunFold {
  latest: LlmExperiment;
  /** The fold's other runs, newest first. */
  earlier: LlmExperiment[];
}

/**
 * Runs with one name on one commit are re-runs; they fold into the latest.
 * The latest, not the mean, stands for the fold everywhere (delta, outcome,
 * trend point): it is the run CI gated on last, and a mean would smooth a
 * flaky run into a value no run produced. The spread keeps the variance in view.
 * The baseline never folds, and a run without a commit has nothing to fold on.
 */
export function foldReruns(runs: LlmExperiment[]): RunFold[] {
  const folds = new Map<string, LlmExperiment[]>();
  for (const run of runs) {
    const commit = gitMeta(run, "commit");
    const key = commit && !run.isBaseline ? JSON.stringify([run.name, commit]) : run.id;
    folds.set(key, [...(folds.get(key) ?? []), run]);
  }
  return [...folds.values()].map((members) => {
    const [latest, ...earlier] = [...members].sort((a, b) => b.createdAt - a.createdAt);
    return { latest, earlier };
  });
}

/** "27–32%" for a boolean score across a fold's completed runs; categorical scores show counts instead. */
export function scoreSpreadLabel(runs: LlmExperiment[], name: string): string | null {
  const values: number[] = [];
  let percent = false;
  for (const run of runs) {
    if (run.status !== "completed") continue;
    const score = experimentEvidence(run).scores.find((entry) => entry.name === name);
    if (score?.kind === "boolean" && score.trueCount + score.falseCount > 0) {
      percent = true;
      values.push(score.trueCount / (score.trueCount + score.falseCount));
    } else if (score?.kind === "numeric" && score.sampleCount > 0) {
      values.push(score.value);
    }
  }
  if (values.length < 2) return null;
  const [min, max] = [Math.min(...values), Math.max(...values)];
  return percent
    ? `${Math.round(min * 100)}–${Math.round(max * 100)}%`
    : `${min.toFixed(3)}–${max.toFixed(3)}`;
}

/**
 * The section a run sits in. Under Pull request a run with no PR falls back to
 * its branch, so CI pushes to main group as "main" beside the PRs.
 */
export function ciGroupKey(run: LlmExperiment, groupBy: ExperimentGroupBy): string | null {
  if (groupBy === "none") return null;
  const pr = groupBy === "pr" ? gitMeta(run, "pr") : null;
  if (pr) return `pr:${pr}`;
  const field = groupBy === "pr" ? "branch" : groupBy;
  const value = gitMeta(run, field);
  return value ? `${field}:${value}` : NO_CI_GROUP;
}

export interface CiGroup {
  key: string;
  kind: "pr" | "branch" | "commit" | null;
  value: string | null;
  runCount: number;
  /** Set when every run in the group shares it. */
  branch: string | null;
  commit: string | null;
  regressed: number;
  improved: number;
  worst: number | null;
  latestAt: number;
}

function shared(values: (string | null)[]): string | null {
  return values.length && values.every((value) => value && value === values[0]) ? values[0] : null;
}

function worstDelta(comparison: RunComparison | null | undefined): number | null {
  return comparison ? comparison.worst.delta : null;
}

/** Ascending worst delta, runs without one last; the baseline stays first as the reference. */
export function sortByRegressions(
  folds: RunFold[],
  comparisons: Map<string, RunComparison | null>,
): RunFold[] {
  const rank = (fold: RunFold) =>
    fold.latest.isBaseline ? -Infinity : (worstDelta(comparisons.get(fold.latest.id)) ?? Infinity);
  return [...folds].sort((left, right) => {
    const a = rank(left);
    const b = rank(right);
    return a === b ? 0 : a < b ? -1 : 1;
  });
}

/** One summary per section, in display order. Counts and the worst move come from each fold's latest. */
export function ciGroups(
  folds: RunFold[],
  groupBy: ExperimentGroupBy,
  sort: ExperimentGroupSort,
  comparisons: Map<string, RunComparison | null>,
): CiGroup[] {
  const buckets = new Map<string, RunFold[]>();
  for (const fold of folds) {
    const key = ciGroupKey(fold.latest, groupBy);
    if (key !== null) buckets.set(key, [...(buckets.get(key) ?? []), fold]);
  }
  const groups = [...buckets].map(([key, members]): CiGroup => {
    const runs = members.flatMap((fold) => [fold.latest, ...fold.earlier]);
    const outcomes = members.map((fold) => comparisons.get(fold.latest.id) ?? null);
    const worsts = outcomes.map(worstDelta).filter((delta): delta is number => delta !== null);
    const split = key.indexOf(":");
    return {
      key,
      kind: key === NO_CI_GROUP ? null : (key.slice(0, split) as CiGroup["kind"]),
      value: key === NO_CI_GROUP ? null : key.slice(split + 1),
      runCount: runs.length,
      branch: shared(runs.map((run) => gitMeta(run, "branch"))),
      commit: shared(runs.map((run) => gitMeta(run, "commit"))),
      regressed: outcomes.filter((c) => c?.outcome === "regressed").length,
      improved: outcomes.filter((c) => c?.outcome === "improved").length,
      worst: worsts.length ? Math.min(...worsts) : null,
      latestAt: Math.max(...runs.map((run) => run.createdAt)),
    };
  });
  return groups.sort((left, right) => {
    if (sort === "regressions") {
      const a = left.worst ?? Infinity;
      const b = right.worst ?? Infinity;
      if (a !== b) return a < b ? -1 : 1;
    } else if ((left.key === NO_CI_GROUP) !== (right.key === NO_CI_GROUP)) {
      // The catch-all for hand and SDK runs is not a change under review.
      return left.key === NO_CI_GROUP ? 1 : -1;
    }
    return right.latestAt - left.latestAt;
  });
}

export interface TrendPoint {
  id: string;
  name: string;
  createdAt: number;
  value: number;
  outcome: BaselineOutcome;
}

export interface ScoreTrend {
  points: TrendPoint[];
  baseline: number;
  band: [number, number];
  /** Share scores read as % healthy; numeric ones in their own units. */
  share: boolean;
  regressed: number;
  improved: number;
}

/** Scores the trend can plot: those the baseline has a measure and a policy for. */
export function trendScores(
  baseline: LlmExperiment,
  policies: Map<string, ScorePolicy>,
): Array<{ name: string; share: boolean }> {
  return experimentEvidence(baseline).scores.flatMap((score) => {
    const policy = policyOf(score, policies);
    return policy && scoreMeasure(score, policy) !== null
      ? [{ name: score.name, share: policy.kind !== "numeric" }]
      : [];
  });
}

/** One point per (folded) completed run, oldest first, judged against the baseline's band. */
export function scoreTrend(
  runs: LlmExperiment[],
  baseline: LlmExperiment,
  name: string,
  policies: Map<string, ScorePolicy>,
): ScoreTrend | null {
  const reference = experimentEvidence(baseline).scores.find((score) => score.name === name);
  const policy = reference ? policyOf(reference, policies) : null;
  const base = reference && policy ? scoreMeasure(reference, policy) : null;
  if (!policy || base === null) return null;
  const points: TrendPoint[] = [];
  for (const run of [...runs].sort((a, b) => a.createdAt - b.createdAt)) {
    if (run.status !== "completed") continue;
    const score = experimentEvidence(run).scores.find((entry) => entry.name === name);
    const value = score ? scoreMeasure(score, policy) : null;
    if (value === null) continue;
    const outcome = classify(orientedDelta(policy, base, value));
    points.push({ id: run.id, name: run.name, createdAt: run.createdAt, value, outcome });
  }
  return {
    points,
    baseline: base,
    band: noiseBand(policy, base),
    share: policy.kind !== "numeric",
    regressed: points.filter((point) => point.outcome === "regressed").length,
    improved: points.filter((point) => point.outcome === "improved").length,
  };
}
