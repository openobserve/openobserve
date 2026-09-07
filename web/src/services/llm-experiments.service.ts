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

import http from "@/services/http";

export interface ExperimentScorerRef {
  id: string;
  version?: number | null;
}

export interface PinnedExperimentScorer {
  id: string;
  version: number;
}

export interface ExperimentPromptMessage {
  role: string;
  content: string;
}

export type ExperimentTask =
  | {
      type: "inline_prompt";
      messages: ExperimentPromptMessage[];
      providerId: string;
      model?: string | null;
      params?: Record<string, unknown> | null;
    }
  | {
      type: "remote";
      /** A published Remote Task pinned as `name` plus its version. Never latest. */
      taskRef: string;
      overrides?: { maxConcurrency?: number; timeoutMs?: number } | null;
    }
  | { type: "sdk"; taskFingerprint: string; config?: Record<string, unknown> };

export interface ExperimentDatasetFilter {
  logicalIds?: string[];
  sources?: Array<"trace" | "annotation" | "manual">;
  tags?: string[];
  metadata?: Record<string, unknown>;
}

export interface ExperimentCreatePayload {
  name: string;
  description?: string | null;
  datasetId: string;
  datasetVersion: number;
  datasetFilter?: ExperimentDatasetFilter | null;
  task: ExperimentTask;
  scorers: ExperimentScorerRef[];
  trialCount: number;
  metadata?: Record<string, unknown> | null;
  idempotencyKey?: string | null;
}

/**
 * Every pin a clone may change, in the same shape the create payload uses.
 *
 * A clone inherits its source's definition, so every field is optional: an
 * omitted one keeps what the source pinned. `description`, `datasetFilter` and
 * `metadata` are nullable on an Experiment, so sending an explicit `null`
 * clears them rather than inheriting.
 */
export interface ExperimentClonePayload {
  name?: string;
  description?: string | null;
  datasetId?: string;
  datasetVersion?: number;
  datasetFilter?: ExperimentDatasetFilter | null;
  task?: ExperimentTask;
  scorers?: ExperimentScorerRef[];
  trialCount?: number;
  metadata?: Record<string, unknown> | null;
  idempotencyKey?: string;
  confirmCostEstimate?: boolean;
}

export interface ExperimentSlot {
  rowId: string;
  logicalId: string;
  trialIndex: number;
  input: unknown;
  expectedOutput: unknown | null;
}

export interface ExperimentPreview {
  datasetId: string;
  datasetVersion: number;
  rowCount: number;
  trialCount: number;
  slotCount: number;
  pinnedScorers: PinnedExperimentScorer[];
  applicability?: ExperimentApplicability;
  sampleSlots: ExperimentSlot[];
}

export interface ExperimentScorerApplicability {
  scorerId: string;
  scorerVersion: number;
  eligibleRowCount: number;
  noReferenceRowCount: number;
  eligibleSlotCount: number;
  noReferenceSlotCount: number;
}

export interface ExperimentApplicability {
  fullySkippedRowCount: number;
  partiallySkippedRowCount: number;
  fullySkippedSlotCount: number;
  partiallySkippedSlotCount: number;
  eligibleTaskSlotCount: number;
  eligibleScoringDimensionCount: number;
  scorerApplicability: ExperimentScorerApplicability[];
}

export interface LlmExperiment extends ExperimentCreatePayload {
  id: string;
  orgId: string;
  /** Resolved server-side from the pinned dataset; null when it was deleted. */
  datasetName: string | null;
  scorers: PinnedExperimentScorer[];
  status: "pending" | "running" | "completed" | "failed" | "cancelled";
  statusReason: string | null;
  deadlineAt: number;
  completedAt: number | null;
  lifecycleVersion: number;
  retryCount: number;
  createdBy: string;
  createdAt: number;
}

export interface ExperimentDetail {
  experiment: LlmExperiment;
  preview: ExperimentPreview;
  results: ExperimentResults;
}

export interface ExperimentExecution {
  experimentId: string;
  itemLogicalId: string;
  rowId: string;
  trialIndex: number;
  status: "pending" | "ok" | "error" | "skipped";
  skipReason?: "no_reference" | "no_trace" | null;
  output: unknown | null;
  errorMessage: string | null;
  latencyMs: number | null;
  tokensIn: number | null;
  tokensOut: number | null;
  cost: number | null;
  traceId: string | null;
  taskFingerprint: string | null;
  timestamp: number;
}

export interface ExperimentRowDetail {
  experimentId: string;
  snapshot: { datasetId: string; datasetVersion: number };
  navigation: {
    rowIndex: number;
    totalRows: number;
    previousRowId: string | null;
    nextRowId: string | null;
  };
  rowId: string;
  logicalId: string;
  input: unknown;
  expectedOutput: unknown | null;
  trials: ExperimentResultSlot[];
  scoreSummaries: ExperimentScoreSummary[];
}

export type ExperimentResultRowSort = "dataset" | "dispersion_desc";

export interface ExperimentResultRow {
  rowIndex: number;
  rowId: string;
  logicalId: string;
  input: unknown;
  expectedOutput: unknown | null;
  trialCount: number;
  status: ExperimentSlotStatus;
  output: unknown | null;
  scoreSummaries: ExperimentScoreSummary[];
  p50LatencyMs: number | null;
  dispersion: ExperimentRowDispersion | null;
}

export interface ExperimentResultRowPage {
  rows: ExperimentResultRow[];
  pagination: {
    page: number;
    pageSize: number;
    totalRows: number;
    hasMore: boolean;
  };
}

export interface ExperimentResultRowPageOptions {
  page?: number;
  pageSize?: number;
  sort?: ExperimentResultRowSort;
  highDispersionOnly?: boolean;
}

export interface ExperimentRowDispersion {
  rowId: string;
  logicalId: string;
  /** Highest normalized spread across this row's trials; null when not computed. */
  maxNormalized: number | null;
  high: boolean;
  outlierTrialIndex: number | null;
}

export interface ExperimentDispersionSummary {
  highDispersionRowCount: number;
  threshold: number;
}

export interface ExperimentResults {
  executions: ExperimentExecution[];
  scores: Record<string, unknown>[];
  slots?: ExperimentResultSlot[];
  pagination?: ExperimentResultPagination;
  taskProgress?: ExperimentProgress;
  scoringProgress?: ExperimentProgress;
  skipSummary?: ExperimentSkipSummary;
  scoreSummaries?: ExperimentScoreSummary[];
  aggregateSummary?: ExperimentAggregateSummary;
  rowDispersions?: ExperimentRowDispersion[];
  dispersionSummary?: ExperimentDispersionSummary;
}

export interface ExperimentResultScore {
  scorerId: string;
  scorerVersion: number;
  status: "pending" | "in_progress" | "success" | "skipped" | "error";
  score: Record<string, unknown> | null;
}

export type ExperimentSlotStatus =
  "pending" | "running" | "scoring" | "completed" | "skipped" | "task_failed" | "score_failed";

export interface ExperimentResultSlot extends ExperimentSlot {
  /** Single lifecycle rollup of task and score evidence — the list-surface field. */
  status: ExperimentSlotStatus;
  taskStatus: "pending" | "in_progress" | "ok" | "skipped" | "error";
  execution: ExperimentExecution | null;
  scores: ExperimentResultScore[];
}

export interface ExperimentResultPagination {
  page: number;
  pageSize: number;
  totalSlots: number;
  hasMore: boolean;
}

export interface ExperimentAggregateSummary {
  p50LatencyMs: number | null;
  totalCost: number;
  incomplete: boolean;
  incompleteTaskSlots: number;
  incompleteScoreDimensions: number;
  errorTaskSlots: number;
}

export interface ExperimentProgress {
  completed: number;
  total: number;
  skipped: number;
}

export interface ExperimentSkipSummary {
  fullySkippedSlots: number;
  partiallySkippedSlots: number;
  skippedDimensions: number;
  noReferenceDimensions: number;
  noTraceDimensions: number;
}

export interface ExperimentScoreSummary {
  scorerId: string;
  scorerVersion: number;
  name: string;
  scoreConfigId: string | null;
  scoreConfigName: string | null;
  scoreConfigVersion: number | null;
  sampleCount: number;
  errorCount: number;
  pendingCount: number;
  noReferenceCount: number;
  noTraceCount: number;
  skippedCount: number;
  value: Record<string, unknown> | null;
}

export type ExperimentComparisonBucket =
  "regressed" | "improved" | "unchanged" | "inconclusive" | "new" | "missing";

export type ExperimentComparisonAssignment =
  | "regressed"
  | "improved"
  | "unchanged"
  | "descriptive"
  | "baseline_only"
  | "candidate_only"
  | "unavailable";

export type ExperimentComparisonScoreDataType = "numeric" | "categorical" | "boolean";

export interface ExperimentComparisonDimension {
  name: string;
  kind: "score" | "cost" | "latency";
  /** Score value type; null for the cost and latency dimensions. */
  dataType: ExperimentComparisonScoreDataType | null;
  scoreConfigId: string | null;
  scoreConfigName: string | null;
  scoreConfigVersion: string | null;
  baseline: number | null;
  candidate: number | null;
  delta: number | null;
  /** Change in the better direction; positive always means improved. */
  orientedDelta: number | null;
  /** Whether the dimension declares a comparison policy and can vote. */
  gating: boolean;
  /** Whether orientedDelta is a fraction of the configured range, not raw units. */
  normalized: boolean;
  baselineSampleCount: number;
  candidateSampleCount: number;
  /** The side's own category name, when it has one unambiguous label. */
  baselineLabel: string | null;
  candidateLabel: string | null;
  /** Normalized trial spread per side; only where a side ran more than one trial. */
  baselineDispersion: number | null;
  candidateDispersion: number | null;
  /** The delta is smaller than the trial noise on both sides. */
  withinNoise: boolean;
  assignment: ExperimentComparisonAssignment;
}

export interface ExperimentComparisonSummaryDimension extends ExperimentComparisonDimension {
  comparableRowCount: number;
  baselineOnlyRowCount: number;
  candidateOnlyRowCount: number;
}

export interface ExperimentComparisonRow {
  logicalId: string;
  input: unknown;
  baselineRowId: string | null;
  candidateRowId: string | null;
  bucket: ExperimentComparisonBucket;
  dimensions: ExperimentComparisonDimension[];
}

export interface ExperimentComparison {
  baselineId: string;
  candidateId: string;
  datasetId: string;
  threshold: number;
  assignmentRule: string;
  counts: {
    baselineRows: number;
    candidateRows: number;
    commonRows: number;
    regressed: number;
    improved: number;
    unchanged: number;
    inconclusive: number;
    new: number;
    missing: number;
  };
  dimensions: ExperimentComparisonSummaryDimension[];
  rows: ExperimentComparisonRow[];
}

export interface ExperimentResultQuery {
  sampleSize?: number;
  resultPage?: number;
  resultPageSize?: number;
}

const TASK_RESULT_STATUSES = ["pending", "in_progress", "ok", "skipped", "error"] as const;
const SCORE_RESULT_STATUSES = ["pending", "in_progress", "success", "skipped", "error"] as const;
const SLOT_STATUSES = [
  "pending",
  "running",
  "scoring",
  "completed",
  "skipped",
  "task_failed",
  "score_failed",
] as const;

// Mirrors the server rollup so a response predating the field still gets one.
function deriveSlotStatus(
  taskStatus: ExperimentResultSlot["taskStatus"],
  scores: ExperimentResultScore[],
): ExperimentSlotStatus {
  if (taskStatus === "pending") return "pending";
  if (taskStatus === "in_progress") return "running";
  if (taskStatus === "error") return "task_failed";
  if (taskStatus === "skipped") return "skipped";
  if (scores.some((s) => s.status === "pending" || s.status === "in_progress")) return "scoring";
  if (scores.some((s) => s.status === "error")) return "score_failed";
  return "completed";
}

function normalizeTaskResultStatus(input: unknown): ExperimentResultSlot["taskStatus"] {
  return TASK_RESULT_STATUSES.includes(input as (typeof TASK_RESULT_STATUSES)[number])
    ? (input as ExperimentResultSlot["taskStatus"])
    : "error";
}

function normalizeScoreResultStatus(input: unknown): ExperimentResultScore["status"] {
  return SCORE_RESULT_STATUSES.includes(input as (typeof SCORE_RESULT_STATUSES)[number])
    ? (input as ExperimentResultScore["status"])
    : "error";
}

export interface CreateExperimentResult extends ExperimentDetail {
  created: boolean;
}

const base = (orgId: string) => `/api/${orgId}/experiments`;

function value<T>(input: any, camel: string, snake: string, fallback: T): T {
  return (input?.[camel] ?? input?.[snake] ?? fallback) as T;
}

function normalizePreview(input: any): ExperimentPreview {
  const applicability = value<any>(input, "applicability", "applicability", {});
  return {
    datasetId: value(input, "datasetId", "dataset_id", ""),
    datasetVersion: Number(value(input, "datasetVersion", "dataset_version", 0)),
    rowCount: Number(value(input, "rowCount", "row_count", 0)),
    trialCount: Number(value(input, "trialCount", "trial_count", 0)),
    slotCount: Number(value(input, "slotCount", "slot_count", 0)),
    pinnedScorers: value<any[]>(input, "pinnedScorers", "pinned_scorers", []).map((scorer) => ({
      id: scorer.id,
      version: Number(scorer.version),
    })),
    applicability: {
      fullySkippedRowCount: Number(
        value(applicability, "fullySkippedRowCount", "fully_skipped_row_count", 0),
      ),
      partiallySkippedRowCount: Number(
        value(applicability, "partiallySkippedRowCount", "partially_skipped_row_count", 0),
      ),
      fullySkippedSlotCount: Number(
        value(applicability, "fullySkippedSlotCount", "fully_skipped_slot_count", 0),
      ),
      partiallySkippedSlotCount: Number(
        value(applicability, "partiallySkippedSlotCount", "partially_skipped_slot_count", 0),
      ),
      eligibleTaskSlotCount: Number(
        value(applicability, "eligibleTaskSlotCount", "eligible_task_slot_count", 0),
      ),
      eligibleScoringDimensionCount: Number(
        value(
          applicability,
          "eligibleScoringDimensionCount",
          "eligible_scoring_dimension_count",
          0,
        ),
      ),
      scorerApplicability: value<any[]>(
        applicability,
        "scorerApplicability",
        "scorer_applicability",
        [],
      ).map((scorer) => ({
        scorerId: value(scorer, "scorerId", "scorer_id", ""),
        scorerVersion: Number(value(scorer, "scorerVersion", "scorer_version", 0)),
        eligibleRowCount: Number(value(scorer, "eligibleRowCount", "eligible_row_count", 0)),
        noReferenceRowCount: Number(
          value(scorer, "noReferenceRowCount", "no_reference_row_count", 0),
        ),
        eligibleSlotCount: Number(value(scorer, "eligibleSlotCount", "eligible_slot_count", 0)),
        noReferenceSlotCount: Number(
          value(scorer, "noReferenceSlotCount", "no_reference_slot_count", 0),
        ),
      })),
    },
    sampleSlots: value<any[]>(input, "sampleSlots", "sample_slots", []).map((slot) => ({
      rowId: value(slot, "rowId", "row_id", ""),
      logicalId: value(slot, "logicalId", "logical_id", ""),
      trialIndex: Number(value(slot, "trialIndex", "trial_index", 0)),
      input: slot.input,
      expectedOutput: value(slot, "expectedOutput", "expected_output", null),
    })),
  };
}

function normalizeExperiment(input: any): LlmExperiment {
  return {
    id: input.id,
    orgId: value(input, "orgId", "org_id", ""),
    name: input.name,
    description: input.description ?? null,
    datasetId: value(input, "datasetId", "dataset_id", ""),
    datasetName: value(input, "datasetName", "dataset_name", null),
    datasetVersion: Number(value(input, "datasetVersion", "dataset_version", 0)),
    datasetFilter: value(input, "datasetFilter", "dataset_filter", null),
    task: input.task,
    scorers: (input.scorers ?? []).map((scorer: any) => ({
      id: scorer.id,
      version: Number(scorer.version),
    })),
    trialCount: Number(value(input, "trialCount", "trial_count", 0)),
    metadata: input.metadata ?? null,
    idempotencyKey: value(input, "idempotencyKey", "idempotency_key", null),
    status: input.status,
    statusReason: value(input, "statusReason", "status_reason", null),
    deadlineAt: Number(value(input, "deadlineAt", "deadline_at", 0)),
    completedAt: value(input, "completedAt", "completed_at", null),
    lifecycleVersion: Number(value(input, "lifecycleVersion", "lifecycle_version", 0)),
    retryCount: Number(value(input, "retryCount", "retry_count", 0)),
    createdBy: value(input, "createdBy", "created_by", ""),
    createdAt: Number(value(input, "createdAt", "created_at", 0)),
  };
}

function numberOrNull(input: unknown): number | null {
  return input === null || input === undefined || input === "" ? null : Number(input);
}

function normalizeResults(input: any): ExperimentResults {
  const taskProgress = value<any>(input, "taskProgress", "task_progress", {});
  const scoringProgress = value<any>(input, "scoringProgress", "scoring_progress", {});
  const skipSummary = value<any>(input, "skipSummary", "skip_summary", {});
  const pagination = value<any>(input, "pagination", "pagination", {});
  const aggregateSummary = value<any>(input, "aggregateSummary", "aggregate_summary", {});
  const dispersionSummary = value<any>(input, "dispersionSummary", "dispersion_summary", {});
  return {
    rowDispersions: value<any[]>(input, "rowDispersions", "row_dispersions", []).map(
      normalizeRowDispersion,
    ),
    dispersionSummary: {
      highDispersionRowCount: Number(
        value(dispersionSummary, "highDispersionRowCount", "high_dispersion_row_count", 0),
      ),
      threshold: Number(value(dispersionSummary, "threshold", "threshold", 0)),
    },
    executions: (input?.executions ?? []).map(normalizeExecution),
    scores: Array.isArray(input?.scores) ? input.scores : [],
    slots: value<any[]>(input, "slots", "slots", []).map(normalizeResultSlot),
    pagination: {
      page: Number(pagination.page ?? 1),
      pageSize: Number(value(pagination, "pageSize", "page_size", 50)),
      totalSlots: Number(value(pagination, "totalSlots", "total_slots", 0)),
      hasMore: Boolean(value(pagination, "hasMore", "has_more", false)),
    },
    taskProgress: normalizeProgress(taskProgress),
    scoringProgress: normalizeProgress(scoringProgress),
    skipSummary: {
      fullySkippedSlots: Number(value(skipSummary, "fullySkippedSlots", "fully_skipped_slots", 0)),
      partiallySkippedSlots: Number(
        value(skipSummary, "partiallySkippedSlots", "partially_skipped_slots", 0),
      ),
      skippedDimensions: Number(value(skipSummary, "skippedDimensions", "skipped_dimensions", 0)),
      noReferenceDimensions: Number(
        value(skipSummary, "noReferenceDimensions", "no_reference_dimensions", 0),
      ),
      noTraceDimensions: Number(value(skipSummary, "noTraceDimensions", "no_trace_dimensions", 0)),
    },
    scoreSummaries: value<any[]>(input, "scoreSummaries", "score_summaries", []).map(
      normalizeScoreSummary,
    ),
    aggregateSummary: {
      p50LatencyMs: value(aggregateSummary, "p50LatencyMs", "p50_latency_ms", null),
      totalCost: Number(value(aggregateSummary, "totalCost", "total_cost", 0)),
      incomplete: Boolean(aggregateSummary.incomplete ?? false),
      incompleteTaskSlots: Number(
        value(aggregateSummary, "incompleteTaskSlots", "incomplete_task_slots", 0),
      ),
      incompleteScoreDimensions: Number(
        value(aggregateSummary, "incompleteScoreDimensions", "incomplete_score_dimensions", 0),
      ),
      errorTaskSlots: Number(value(aggregateSummary, "errorTaskSlots", "error_task_slots", 0)),
    },
  };
}

function normalizeExecution(record: any): ExperimentExecution {
  return {
    experimentId: value(record, "experimentId", "experiment_id", ""),
    itemLogicalId: value(record, "itemLogicalId", "item_logical_id", ""),
    rowId: value(record, "rowId", "row_id", ""),
    trialIndex: Number(value(record, "trialIndex", "trial_index", 0)),
    status: record.status,
    skipReason: value(record, "skipReason", "skip_reason", null),
    output: record.output ?? null,
    errorMessage: value(record, "errorMessage", "error_message", null),
    latencyMs: value(record, "latencyMs", "latency_ms", null),
    tokensIn: value(record, "tokensIn", "tokens_in", null),
    tokensOut: value(record, "tokensOut", "tokens_out", null),
    cost: record.cost ?? null,
    traceId: value(record, "traceId", "trace_id", null),
    taskFingerprint: value(record, "taskFingerprint", "task_fingerprint", null),
    timestamp: Number(record._timestamp ?? record.timestamp ?? 0),
  };
}

function normalizeResultSlot(slot: any): ExperimentResultSlot {
  const taskStatus = normalizeTaskResultStatus(value(slot, "taskStatus", "task_status", "pending"));
  const scores: ExperimentResultScore[] = (slot.scores ?? []).map((score: any) => ({
    scorerId: value(score, "scorerId", "scorer_id", ""),
    scorerVersion: Number(value(score, "scorerVersion", "scorer_version", 0)),
    status: normalizeScoreResultStatus(score.status ?? "pending"),
    score: score.score ?? null,
  }));
  const status = SLOT_STATUSES.includes(slot.status)
    ? (slot.status as ExperimentSlotStatus)
    : deriveSlotStatus(taskStatus, scores);
  return {
    rowId: value(slot, "rowId", "row_id", ""),
    logicalId: value(slot, "logicalId", "logical_id", ""),
    trialIndex: Number(value(slot, "trialIndex", "trial_index", 0)),
    input: slot.input,
    expectedOutput: value(slot, "expectedOutput", "expected_output", null),
    status,
    taskStatus,
    execution: slot.execution ? normalizeExecution(slot.execution) : null,
    scores,
  };
}

function normalizeScoreSummary(summary: any): ExperimentScoreSummary {
  return {
    scorerId: value(summary, "scorerId", "scorer_id", ""),
    scorerVersion: Number(value(summary, "scorerVersion", "scorer_version", 0)),
    name: String(summary?.name ?? ""),
    scoreConfigId: value(summary, "scoreConfigId", "score_config_id", null),
    scoreConfigName: value(summary, "scoreConfigName", "score_config_name", null),
    scoreConfigVersion: numberOrNull(
      value(summary, "scoreConfigVersion", "score_config_version", null),
    ),
    sampleCount: Number(value(summary, "sampleCount", "sample_count", 0)),
    errorCount: Number(value(summary, "errorCount", "error_count", 0)),
    pendingCount: Number(value(summary, "pendingCount", "pending_count", 0)),
    noReferenceCount: Number(value(summary, "noReferenceCount", "no_reference_count", 0)),
    noTraceCount: Number(value(summary, "noTraceCount", "no_trace_count", 0)),
    skippedCount: Number(value(summary, "skippedCount", "skipped_count", 0)),
    value: summary.value ?? null,
  };
}

function normalizeRowDispersion(row: any): ExperimentRowDispersion {
  return {
    rowId: String(value(row, "rowId", "row_id", "")),
    logicalId: String(value(row, "logicalId", "logical_id", "")),
    maxNormalized: numberOrNull(value(row, "maxNormalized", "max_normalized", null)),
    high: Boolean(row?.high),
    outlierTrialIndex: numberOrNull(value(row, "outlierTrialIndex", "outlier_trial_index", null)),
  };
}

export function normalizeExperimentResultRowPage(input: any): ExperimentResultRowPage {
  const pagination = input?.pagination ?? {};
  return {
    rows: (input?.rows ?? []).map((row: any) => ({
      rowIndex: Number(value(row, "rowIndex", "row_index", 0)),
      rowId: String(value(row, "rowId", "row_id", "")),
      logicalId: String(value(row, "logicalId", "logical_id", "")),
      input: row?.input,
      expectedOutput: value(row, "expectedOutput", "expected_output", null),
      trialCount: Number(value(row, "trialCount", "trial_count", 0)),
      status: row?.status as ExperimentSlotStatus,
      output: row?.output ?? null,
      scoreSummaries: value<any[]>(row, "scoreSummaries", "score_summaries", []).map(
        normalizeScoreSummary,
      ),
      p50LatencyMs: numberOrNull(value(row, "p50LatencyMs", "p50_latency_ms", null)),
      dispersion: row?.dispersion ? normalizeRowDispersion(row.dispersion) : null,
    })),
    pagination: {
      page: Number(pagination.page ?? 1),
      pageSize: Number(value(pagination, "pageSize", "page_size", 50)),
      totalRows: Number(value(pagination, "totalRows", "total_rows", 0)),
      hasMore: Boolean(value(pagination, "hasMore", "has_more", false)),
    },
  };
}

export function normalizeExperimentRowDetail(input: any): ExperimentRowDetail {
  const snapshot = input?.snapshot ?? {};
  const navigation = input?.navigation ?? {};
  return {
    experimentId: value(input, "experimentId", "experiment_id", ""),
    snapshot: {
      datasetId: value(snapshot, "datasetId", "dataset_id", ""),
      datasetVersion: Number(value(snapshot, "datasetVersion", "dataset_version", 0)),
    },
    navigation: {
      rowIndex: Number(value(navigation, "rowIndex", "row_index", 0)),
      totalRows: Number(value(navigation, "totalRows", "total_rows", 0)),
      previousRowId: value(navigation, "previousRowId", "previous_row_id", null),
      nextRowId: value(navigation, "nextRowId", "next_row_id", null),
    },
    rowId: value(input, "rowId", "row_id", ""),
    logicalId: value(input, "logicalId", "logical_id", ""),
    input: input?.input,
    expectedOutput: value(input, "expectedOutput", "expected_output", null),
    trials: value<any[]>(input, "trials", "trials", []).map(normalizeResultSlot),
    scoreSummaries: value<any[]>(input, "scoreSummaries", "score_summaries", []).map(
      normalizeScoreSummary,
    ),
  };
}

function normalizeComparisonDimension(input: any): ExperimentComparisonDimension {
  const scoreConfigId = value<unknown>(input, "scoreConfigId", "score_config_id", null);
  const scoreConfigName = value<unknown>(input, "scoreConfigName", "score_config_name", null);
  const scoreConfigVersion = value<unknown>(
    input,
    "scoreConfigVersion",
    "score_config_version",
    null,
  );
  return {
    name: String(input?.name ?? ""),
    kind: input?.kind,
    dataType: value(input, "dataType", "data_type", null),
    scoreConfigId: scoreConfigId === null ? null : String(scoreConfigId),
    scoreConfigName: scoreConfigName === null ? null : String(scoreConfigName),
    scoreConfigVersion: scoreConfigVersion === null ? null : String(scoreConfigVersion),
    baseline: value(input, "baseline", "baseline", null),
    candidate: value(input, "candidate", "candidate", null),
    delta: value(input, "delta", "delta", null),
    orientedDelta: value(input, "orientedDelta", "oriented_delta", null),
    gating: Boolean(value(input, "gating", "gating", false)),
    normalized: Boolean(value(input, "normalized", "normalized", false)),
    baselineSampleCount: Number(value(input, "baselineSampleCount", "baseline_sample_count", 0)),
    candidateSampleCount: Number(value(input, "candidateSampleCount", "candidate_sample_count", 0)),
    baselineLabel: value(input, "baselineLabel", "baseline_label", null),
    candidateLabel: value(input, "candidateLabel", "candidate_label", null),
    baselineDispersion: value(input, "baselineDispersion", "baseline_dispersion", null),
    candidateDispersion: value(input, "candidateDispersion", "candidate_dispersion", null),
    withinNoise: Boolean(value(input, "withinNoise", "within_noise", false)),
    assignment: input?.assignment,
  };
}

export function normalizeExperimentComparison(input: any): ExperimentComparison {
  const counts = input?.counts ?? {};
  return {
    baselineId: value(input, "baselineId", "baseline_id", ""),
    candidateId: value(input, "candidateId", "candidate_id", ""),
    datasetId: value(input, "datasetId", "dataset_id", ""),
    threshold: Number(input?.threshold ?? 0),
    assignmentRule: value(input, "assignmentRule", "assignment_rule", ""),
    counts: {
      baselineRows: Number(value(counts, "baselineRows", "baseline_rows", 0)),
      candidateRows: Number(value(counts, "candidateRows", "candidate_rows", 0)),
      commonRows: Number(value(counts, "commonRows", "common_rows", 0)),
      regressed: Number(counts.regressed ?? 0),
      improved: Number(counts.improved ?? 0),
      unchanged: Number(counts.unchanged ?? 0),
      inconclusive: Number(counts.inconclusive ?? 0),
      new: Number(counts.new ?? 0),
      missing: Number(counts.missing ?? 0),
    },
    dimensions: value<any[]>(input, "dimensions", "dimensions", []).map((dimension) => ({
      ...normalizeComparisonDimension(dimension),
      comparableRowCount: Number(value(dimension, "comparableRowCount", "comparable_row_count", 0)),
      baselineOnlyRowCount: Number(
        value(dimension, "baselineOnlyRowCount", "baseline_only_row_count", 0),
      ),
      candidateOnlyRowCount: Number(
        value(dimension, "candidateOnlyRowCount", "candidate_only_row_count", 0),
      ),
    })),
    rows: value<any[]>(input, "rows", "rows", []).map((row) => ({
      logicalId: value(row, "logicalId", "logical_id", ""),
      input: value(row, "input", "input", null),
      baselineRowId: value(row, "baselineRowId", "baseline_row_id", null),
      candidateRowId: value(row, "candidateRowId", "candidate_row_id", null),
      bucket: row.bucket,
      dimensions: (row.dimensions ?? []).map(normalizeComparisonDimension),
    })),
  };
}

function normalizeProgress(input: any): ExperimentProgress {
  return {
    completed: Number(input?.completed ?? 0),
    total: Number(input?.total ?? 0),
    skipped: Number(input?.skipped ?? 0),
  };
}

const llmExperimentsService = {
  async list(orgId: string): Promise<LlmExperiment[]> {
    const response = await http().get(base(orgId));
    const rows = Array.isArray(response.data) ? response.data : (response.data?.list ?? []);
    return rows.map(normalizeExperiment);
  },

  async preview(
    orgId: string,
    payload: ExperimentCreatePayload,
    sampleSize = 5,
  ): Promise<ExperimentPreview> {
    const response = await http().post(`${base(orgId)}/preview`, payload, {
      params: { sampleSize },
    });
    return normalizePreview(response.data);
  },

  async create(orgId: string, payload: ExperimentCreatePayload): Promise<CreateExperimentResult> {
    const response = await http().post(base(orgId), payload);
    return {
      experiment: normalizeExperiment(response.data?.experiment),
      preview: normalizePreview(response.data?.preview),
      results: normalizeResults({}),
      created: response.data?.created === true,
    };
  },

  async get(
    orgId: string,
    experimentId: string,
    options: number | ExperimentResultQuery = 5,
  ): Promise<ExperimentDetail> {
    const params =
      typeof options === "number"
        ? { sampleSize: options }
        : {
            sampleSize: options.sampleSize ?? 5,
            resultPage: options.resultPage ?? 1,
            resultPageSize: options.resultPageSize ?? 50,
          };
    const response = await http().get(`${base(orgId)}/${experimentId}`, {
      params,
    });
    return {
      experiment: normalizeExperiment(response.data?.experiment),
      preview: normalizePreview(response.data?.preview),
      results: normalizeResults(response.data?.results),
    };
  },

  async compare(
    orgId: string,
    baselineId: string,
    candidateId: string,
    // Omitted rather than defaulted: the server owns the neutral threshold, and
    // a client-side default silently overrides it (a 0 here makes every
    // movement a regression).
    threshold?: number,
  ): Promise<ExperimentComparison> {
    const response = await http().get(`${base(orgId)}/compare`, {
      params: { baselineId, candidateId, ...(threshold === undefined ? {} : { threshold }) },
    });
    return normalizeExperimentComparison(response.data);
  },

  async cancel(orgId: string, experimentId: string): Promise<LlmExperiment> {
    const response = await http().post(`${base(orgId)}/${experimentId}/cancel`);
    return normalizeExperiment(response.data);
  },

  async getRow(orgId: string, experimentId: string, rowId: string): Promise<ExperimentRowDetail> {
    const response = await http().get(
      `${base(orgId)}/${experimentId}/rows/${encodeURIComponent(rowId)}`,
    );
    return normalizeExperimentRowDetail(response.data);
  },

  async listRows(
    orgId: string,
    experimentId: string,
    options: ExperimentResultRowPageOptions = {},
  ): Promise<ExperimentResultRowPage> {
    const response = await http().get(`${base(orgId)}/${experimentId}/rows`, {
      params: options,
    });
    return normalizeExperimentResultRowPage(response.data);
  },

  async retry(orgId: string, experimentId: string): Promise<LlmExperiment> {
    const response = await http().post(`${base(orgId)}/${experimentId}/retry`);
    return normalizeExperiment(response.data);
  },

  async retrySlot(
    orgId: string,
    experimentId: string,
    rowId: string,
    trialIndex: number,
    idempotencyKey: string,
  ): Promise<ExperimentExecution> {
    const response = await http().post(
      `${base(orgId)}/${experimentId}/rows/${encodeURIComponent(rowId)}/trials/${trialIndex}/retry`,
      { idempotencyKey },
    );
    return normalizeExecution(response.data);
  },

  async clone(
    orgId: string,
    experimentId: string,
    overrides: ExperimentClonePayload = {},
  ): Promise<LlmExperiment> {
    const response = await http().post(`${base(orgId)}/${experimentId}/clone`, overrides);
    return normalizeExperiment(response.data);
  },
};

export default llmExperimentsService;
