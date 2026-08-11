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
  sampleSlots: ExperimentSlot[];
}

export interface LlmExperiment extends ExperimentCreatePayload {
  id: string;
  orgId: string;
  scorers: PinnedExperimentScorer[];
  status: "pending" | "running" | "completed" | "failed" | "cancelled";
  createdBy: string;
  createdAt: number;
}

export interface ExperimentDetail {
  experiment: LlmExperiment;
  preview: ExperimentPreview;
}

export interface CreateExperimentResult extends ExperimentDetail {
  created: boolean;
}

const base = (orgId: string) => `/api/${orgId}/experiments`;

function value<T>(input: any, camel: string, snake: string, fallback: T): T {
  return (input?.[camel] ?? input?.[snake] ?? fallback) as T;
}

function normalizePreview(input: any): ExperimentPreview {
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
    createdBy: value(input, "createdBy", "created_by", ""),
    createdAt: Number(value(input, "createdAt", "created_at", 0)),
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
    };
  },
};

export default llmExperimentsService;
