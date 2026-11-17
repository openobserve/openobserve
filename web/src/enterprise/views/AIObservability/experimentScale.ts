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

// Baseline verdicts mirror Compare's rule (score_policy.rs + comparison.rs); keep them in sync.

import type { ExperimentComparison, LlmExperiment } from "@/services/llm-experiments.service";
import type { ScoreConfig } from "@/services/online-evals.service";
import {
  dataTypeOf,
  entityId,
  valueOf,
} from "@/enterprise/components/onlineEvals/utils/evalEntity";
import {
  clientScoreKey,
  experimentEvidence,
  type ExperimentScoreSummary,
} from "./experimentDiscovery";

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

// ponytail: keyed by entity, not version, so a run pinned to an older config is judged by the current policy.
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

/** An unranged numeric score moves relative to its baseline's value, so its delta reads as a percent, not points. */
export function isRelative(policy: ScorePolicy | null | undefined): boolean {
  return policy?.kind === "numeric" && policy.span === null;
}

/** `scoring_failed` is terminal, as Compare treats it; only its clean scores vote. */
export function isSettled(run: LlmExperiment): boolean {
  return run.status === "completed" || run.status === "scoring_failed";
}

/** Every row of the score was scored: no Scorer error and nothing pending. */
export function isCleanScore(score: Pick<ExperimentScoreSummary, "errorCount" | "pendingCount">) {
  return !score.errorCount && !score.pendingCount;
}

/** The run's score columns that cannot vote, because a Scorer failed or has not finished on a row. */
function uncleanKeys(run: LlmExperiment): Set<string> {
  return new Set(
    experimentEvidence(run)
      .scores.filter((score) => !isCleanScore(score))
      .map((score) => score.key),
  );
}

/** The values a run can take and still be within noise: the threshold in the score's own units. */
export function noiseBand(policy: ScorePolicy, baseline: number): [number, number] {
  const scale = policy.kind === "numeric" ? (policy.span ?? Math.abs(baseline)) : 1;
  const half = COMPARISON_THRESHOLD * scale;
  return [baseline - half, baseline + half];
}

/** Float noise is trimmed before the strict test so an exact threshold-sized move stays unchanged, as in Compare's `classify_delta`. */
function classify(delta: number): BaselineOutcome {
  const rounded = (Math.sign(delta) * Math.round(Math.abs(delta) * 1e9)) / 1e9;
  if (rounded < -COMPARISON_THRESHOLD) return "regressed";
  return rounded > COMPARISON_THRESHOLD ? "improved" : "unchanged";
}

/** A score column's identity and label, carried by every per-score result. */
export type ScoreColumn = Pick<ExperimentScoreSummary, "key" | "name" | "clientScorerKey">;

export interface ScoreDelta extends ScoreColumn {
  /** Oriented so positive is better: a share of the range (points), or of the baseline when `relative`. */
  delta: number;
  relative: boolean;
  outcome: BaselineOutcome;
}

function scoreColumn({ key, name, clientScorerKey }: ScoreColumn): ScoreColumn {
  return { key, name, clientScorerKey };
}

export interface RunComparison {
  outcome: BaselineOutcome;
  /** By score column key. */
  deltas: Map<string, ScoreDelta>;
  /** Lowest delta; regressions-first sorts on it. */
  worst: ScoreDelta;
  /** The move the outcome is named for: the worst, or the best when improved. */
  headline: ScoreDelta;
  /** Set when the run and its baseline ran different cases and only the shared ones were compared. */
  cases: { shared: number; excluded: number } | null;
}

function policyOf(score: ExperimentScoreSummary, policies: Map<string, ScorePolicy>) {
  return score.scoreConfigId ? (policies.get(score.scoreConfigId) ?? null) : null;
}

/** Same dataset version and filter: both runs ran the same cases, so their means compare directly. */
export function sameCases(run: LlmExperiment, baseline: LlmExperiment): boolean {
  return (
    run.datasetVersion === baseline.datasetVersion &&
    JSON.stringify(run.datasetFilter ?? null) === JSON.stringify(baseline.datasetFilter ?? null)
  );
}

/** Compare's answer over the cases a run and its baseline both ran, per score. */
export interface SharedCaseComparison {
  shared: number;
  /** Cases only one side ran: new in the run, or missing from it. */
  excluded: number;
  /** `delta` is oriented so positive is better; `change` is raw. */
  scores: Map<
    string,
    ScoreColumn & { delta: number; change: number; scoreConfigId: string | null }
  >;
}

/** Compare names a client dimension `<client key> · client` (comparison.rs `score_dimension_key`). */
const CLIENT_DIMENSION_SUFFIX = " · client";

/** The list column a Compare score dimension measures, so its move lands in that column. */
function comparisonColumn(dimension: ExperimentComparison["dimensions"][number]): ScoreColumn {
  if (dimension.scoreConfigId && dimension.name.endsWith(CLIENT_DIMENSION_SUFFIX)) {
    const clientScorerKey = dimension.name.slice(0, -CLIENT_DIMENSION_SUFFIX.length);
    return {
      key: clientScoreKey(dimension.scoreConfigId, clientScorerKey),
      name: dimension.scoreConfigName || clientScorerKey,
      clientScorerKey,
    };
  }
  const name = dimension.scoreConfigName || dimension.name;
  return { key: name, name, clientScorerKey: null };
}

/** Only voting score dimensions with paired evidence, the ones Compare's own verdict rests on. */
export function sharedCaseComparison(comparison: ExperimentComparison): SharedCaseComparison {
  const scores: SharedCaseComparison["scores"] = new Map();
  for (const dimension of comparison.dimensions) {
    if (dimension.kind !== "score" || !dimension.gating || !dimension.comparableRowCount) continue;
    if (dimension.orientedDelta === null || dimension.delta === null) continue;
    const column = comparisonColumn(dimension);
    scores.set(column.key, {
      ...column,
      delta: dimension.orientedDelta,
      change: dimension.delta,
      scoreConfigId: dimension.scoreConfigId || null,
    });
  }
  return {
    shared: comparison.counts.commonRows,
    excluded: comparison.counts.new + comparison.counts.missing,
    scores,
  };
}

function verdict(
  deltas: Map<string, ScoreDelta>,
  cases: RunComparison["cases"],
): RunComparison | null {
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
  return { outcome, deltas, worst, headline: outcome === "improved" ? best : worst, cases };
}

/** Only score columns vote; a run on other cases than its baseline waits for `shared`, since its means are not comparable. */
export function compareToBaseline(
  run: LlmExperiment,
  baseline: LlmExperiment | null,
  policies: Map<string, ScorePolicy>,
  shared?: SharedCaseComparison | null,
): RunComparison | null {
  if (!baseline || run.id === baseline.id) return null;
  // Partial summaries of a live run would read as moves that are not there yet.
  if (!isSettled(run) || baseline.status !== "completed") return null;
  const deltas = new Map<string, ScoreDelta>();
  const unclean = uncleanKeys(run);
  if (!sameCases(run, baseline)) {
    if (!shared) return null;
    for (const [key, move] of shared.scores) {
      if (unclean.has(key)) continue;
      const relative = isRelative(move.scoreConfigId ? policies.get(move.scoreConfigId) : null);
      deltas.set(key, {
        ...scoreColumn(move),
        delta: move.delta,
        relative,
        outcome: classify(move.delta),
      });
    }
    return verdict(deltas, { shared: shared.shared, excluded: shared.excluded });
  }
  // Columns match on key: a client dimension pairs only with the same Score Config and client key.
  const reference = new Map(experimentEvidence(baseline).scores.map((s) => [s.key, s]));
  for (const score of experimentEvidence(run).scores) {
    const other = reference.get(score.key);
    const policy = policyOf(score, policies);
    if (!other || !policy || unclean.has(score.key)) continue;
    const candidate = scoreMeasure(score, policy);
    const base = scoreMeasure(other, policy);
    if (candidate === null || base === null) continue;
    const delta = orientedDelta(policy, base, candidate);
    deltas.set(score.key, {
      ...scoreColumn(score),
      delta,
      relative: isRelative(policy),
      outcome: classify(delta),
    });
  }
  return verdict(deltas, null);
}

/** "−10.7" from −0.107: a fraction as signed points, with a real minus sign. */
export function signedPoints(delta: number): string {
  const points = (delta * 100).toFixed(1);
  if (Number(points) === 0) return "0.0";
  return delta > 0 ? `+${points}` : points.replace("-", "−");
}

/** A move as the list prints it: signed points, or a percent of the baseline for an unranged score. */
export function signedDelta(move: Pick<ScoreDelta, "delta" | "relative">): string {
  return move.relative ? `${signedPoints(move.delta)}%` : signedPoints(move.delta);
}

export interface RunFold {
  /** The run that stands for the fold: the newest settled one, else the newest. */
  latest: LlmExperiment;
  /** The fold's other runs, newest first. */
  earlier: LlmExperiment[];
  /** The newest run, when it is newer than `latest` and did not settle (cancelled, failed or still going). */
  newerIncomplete: LlmExperiment | null;
}

/** Re-runs fold into the newest settled run, not a mean, which would smooth a flaky run into a value no run produced. */
export function foldReruns(runs: LlmExperiment[]): RunFold[] {
  const folds = new Map<string, LlmExperiment[]>();
  for (const run of runs) {
    const commit = gitMeta(run, "commit");
    const key = commit && !run.isBaseline ? JSON.stringify([run.name, commit]) : run.id;
    folds.set(key, [...(folds.get(key) ?? []), run]);
  }
  return [...folds.values()].map((members) => {
    const newestFirst = [...members].sort((a, b) => b.createdAt - a.createdAt);
    const latest = newestFirst.find(isSettled) ?? newestFirst[0];
    return {
      latest,
      earlier: newestFirst.filter((run) => run !== latest),
      newerIncomplete: newestFirst[0] === latest ? null : newestFirst[0],
    };
  });
}

/** Why a run has no verdict: it was cancelled, it failed, or it is still going. */
export type IncompleteKind = "cancelled" | "failed" | "inProgress";

export function incompleteKind(run: LlmExperiment): IncompleteKind | null {
  if (isSettled(run)) return null;
  if (run.status === "cancelled") return "cancelled";
  return run.status === "failed" || run.status === "execution_failed" ? "failed" : "inProgress";
}

export interface RunTally {
  settled: number;
  incomplete: Record<IncompleteKind, number>;
}

export function tallyRuns(runs: LlmExperiment[]): RunTally {
  const tally: RunTally = { settled: 0, incomplete: { cancelled: 0, failed: 0, inProgress: 0 } };
  for (const run of runs) {
    const kind = incompleteKind(run);
    if (kind) tally.incomplete[kind] += 1;
    else tally.settled += 1;
  }
  return tally;
}

export function scoreSpread(
  runs: LlmExperiment[],
  key: string,
): { count: number; range: string } | null {
  const values: number[] = [];
  let percent = false;
  for (const run of runs) {
    if (!isSettled(run)) continue;
    const score = experimentEvidence(run).scores.find((entry) => entry.key === key);
    if (!score || !isCleanScore(score)) continue;
    if (score.kind === "boolean" && score.trueCount + score.falseCount > 0) {
      percent = true;
      values.push(score.trueCount / (score.trueCount + score.falseCount));
    } else if (score.kind === "numeric" && score.sampleCount > 0) {
      values.push(score.value);
    }
  }
  if (values.length < 2) return null;
  const [low, high] = [Math.min(...values), Math.max(...values)].map((value) =>
    percent ? String(Math.round(value * 100)) : value.toFixed(3),
  );
  const range = low === high ? low : `${low}–${high}`;
  return { count: values.length, range: percent ? `${range}%` : range };
}

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
  /** Every run in the section, re-runs included: settled ones and why the rest have no verdict. */
  runs: RunTally;
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
      runs: tallyRuns(runs),
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
): Array<ScoreColumn & { share: boolean }> {
  return experimentEvidence(baseline).scores.flatMap((score) => {
    const policy = policyOf(score, policies);
    return policy && scoreMeasure(score, policy) !== null
      ? [{ ...scoreColumn(score), share: policy.kind !== "numeric" }]
      : [];
  });
}

/** A run on other cases than the baseline is plotted from `shared` and omitted until it arrives. */
export function scoreTrend(
  runs: LlmExperiment[],
  baseline: LlmExperiment,
  key: string,
  policies: Map<string, ScorePolicy>,
  shared: Map<string, SharedCaseComparison>,
): ScoreTrend | null {
  const reference = experimentEvidence(baseline).scores.find((score) => score.key === key);
  const policy = reference ? policyOf(reference, policies) : null;
  const base = reference && policy ? scoreMeasure(reference, policy) : null;
  if (!policy || base === null) return null;
  const points: TrendPoint[] = [];
  for (const run of [...runs].sort((a, b) => a.createdAt - b.createdAt)) {
    if (!isSettled(run) || uncleanKeys(run).has(key)) continue;
    let value: number | null;
    let outcome: BaselineOutcome;
    if (sameCases(run, baseline)) {
      const score = experimentEvidence(run).scores.find((entry) => entry.key === key);
      value = score ? scoreMeasure(score, policy) : null;
      if (value === null) continue;
      outcome = classify(orientedDelta(policy, base, value));
    } else {
      const move = shared.get(run.id)?.scores.get(key);
      if (!move) continue;
      // The baseline's value plus the shared-case change: the point sits where its verdict says.
      value = base + move.change;
      outcome = classify(move.delta);
    }
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
