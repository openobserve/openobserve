// Copyright 2026 OpenObserve Inc.
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.

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
  | { type: "remote"; config: Record<string, unknown> }
  | { type: "sdk"; config: Record<string, unknown> };

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
  status: "ok" | "error" | "skipped";
  skipReason?: "no_reference" | "no_trace" | null;
  output: unknown | null;
  errorMessage: string | null;
  latencyMs: number | null;
  tokensIn: number | null;
  tokensOut: number | null;
  cost: number | null;
  traceId: string | null;
  timestamp: number;
}

export interface ExperimentResults {
  executions: ExperimentExecution[];
  scores: Record<string, unknown>[];
  taskProgress?: ExperimentProgress;
  scoringProgress?: ExperimentProgress;
  skipSummary?: ExperimentSkipSummary;
  scoreSummaries?: ExperimentScoreSummary[];
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
  sampleCount: number;
  noReferenceCount: number;
  noTraceCount: number;
  skippedCount: number;
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

function normalizeResults(input: any): ExperimentResults {
  const taskProgress = value<any>(input, "taskProgress", "task_progress", {});
  const scoringProgress = value<any>(input, "scoringProgress", "scoring_progress", {});
  const skipSummary = value<any>(input, "skipSummary", "skip_summary", {});
  return {
    executions: (input?.executions ?? []).map((record: any) => ({
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
      timestamp: Number(record._timestamp ?? record.timestamp ?? 0),
    })),
    scores: Array.isArray(input?.scores) ? input.scores : [],
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
    scoreSummaries: value<any[]>(input, "scoreSummaries", "score_summaries", []).map((summary) => ({
      scorerId: value(summary, "scorerId", "scorer_id", ""),
      scorerVersion: Number(value(summary, "scorerVersion", "scorer_version", 0)),
      sampleCount: Number(value(summary, "sampleCount", "sample_count", 0)),
      noReferenceCount: Number(value(summary, "noReferenceCount", "no_reference_count", 0)),
      noTraceCount: Number(value(summary, "noTraceCount", "no_trace_count", 0)),
      skippedCount: Number(value(summary, "skippedCount", "skipped_count", 0)),
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

  async get(orgId: string, experimentId: string, sampleSize = 5): Promise<ExperimentDetail> {
    const response = await http().get(`${base(orgId)}/${experimentId}`, {
      params: { sampleSize },
    });
    return {
      experiment: normalizeExperiment(response.data?.experiment),
      preview: normalizePreview(response.data?.preview),
      results: normalizeResults(response.data?.results),
    };
  },

  async cancel(orgId: string, experimentId: string): Promise<LlmExperiment> {
    const response = await http().post(`${base(orgId)}/${experimentId}/cancel`);
    return normalizeExperiment(response.data);
  },

  async retry(orgId: string, experimentId: string): Promise<LlmExperiment> {
    const response = await http().post(`${base(orgId)}/${experimentId}/retry`);
    return normalizeExperiment(response.data);
  },
};

export default llmExperimentsService;
