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

// ─── LLM Annotation · Queues ────────────────────────────────────────────────

/** The dimension type a Score Config scores on. */
export type ScoreConfigDataType = "numeric" | "categorical" | "boolean";

/** One bound, immutable Score Config version. */
export interface LlmQueueBinding {
  /** Physical Score Config row ID required by the review API. */
  rowId: string;
  /** Logical Score Config identity (stable across versions). */
  scoreConfigId: string;
  name: string;
  version: number;
  dataType: ScoreConfigDataType;
  /** Latest available version, populated by the queue overview page. */
  latestVersion?: number;
}

/** One review queue, normalized for the UI. */
export interface LlmQueue {
  id: string;
  orgId?: string;
  name: string;
  description: string | null;
  targetDatasetId: string | null;
  /** Resolved by the queue list API — no Dataset catalog fetch needed. */
  targetDatasetName: string | null;
  allowedRefTypes: string[];
  scoreConfigs: LlmQueueBinding[];
  /** Review progress, aggregated by the list API over non-archived Queue Items. */
  reviewedCount: number;
  totalCount: number;
  createdBy?: string;
  createdAt?: number;
  updatedBy?: string;
  updatedAt?: number;
}

export interface LlmScoreConfigVersionDetails {
  rowId: string;
  categories?: string[];
  numericRange?: { min: number; max: number };
  healthyThreshold?: Record<string, unknown>;
}

/** A Score Config available to bind, with all selectable versions. */
export interface LlmScoreConfigOption {
  id: string;
  name: string;
  dataType: ScoreConfigDataType;
  categories?: string[];
  versions: number[];
  latestVersion: number;
  versionDetails: Record<number, LlmScoreConfigVersionDetails>;
}

export type LlmQueueItemStatus = "pending" | "reviewed";
export type QueueRefType = "session" | "trace" | "span";

export interface LlmQueueItem {
  id: string;
  queueId: string;
  queueName: string | null;
  refType: QueueRefType;
  refId: string;
  refTraceId: string | null;
  /** Lower bound for trace hydration and Score lookup, in microseconds. */
  refTraceStartTime: number;
  status: LlmQueueItemStatus;
  reviewedAt: number | null;
  archivedAt: number | null;
  createdAt: number;
  updatedAt: number;
}

export interface LlmQueueMachineScore {
  id: string;
  name: string;
  value: number | string | boolean | null;
  dataType: ScoreConfigDataType;
  sourceType: string;
  sourceStream: string | null;
  reasoning: string | null;
  timestamp: number;
}

export interface LlmQueueItemDetail {
  item: LlmQueueItem;
  sourceStream: string;
  content: {
    input: unknown | null;
    output: unknown | null;
    trace: Record<string, unknown>[];
  };
  machineScores: LlmQueueMachineScore[];
  reviews: LlmQueueReview[];
}

export interface LlmQueueReviewScore {
  name: string;
  value: number | string | boolean | null;
}

export interface LlmQueueReview {
  submissionId: string;
  reviewer: string | null;
  comments: string | null;
  /** Score event timestamp, in microseconds. */
  submittedAt: number;
  scores: LlmQueueReviewScore[];
}

export interface LlmQueueReviewPayload {
  submissionId: string;
  sourceStream: string;
  scores: { scoreConfigRowId: string; value: number | string | boolean }[];
  comments?: string | null;
}

export interface LlmQueueReviewResult {
  annotationId: string;
  scoreIds: string[];
  annotatedAt: number;
}

/** Distill payload. `input` is NOT sent — the server hydrates it from the item's
 *  telemetry reference; the human only supplies the golden answer. */
export interface LlmDistillPayload {
  datasetId: string;
  /** The N/N review submission used as adjudication evidence. */
  reviewSubmissionId: string;
  expectedOutput: string;
  tags?: string[];
}

export interface LlmDistillResult {
  /** False when the item was already distilled into this dataset (idempotent). */
  created: boolean;
  datasetItemId: string;
}

/** Create payload. Only fields accepted by the backend are represented. */
export interface LlmQueuePayload {
  name: string;
  description?: string | null;
  targetDatasetId?: string | null;
  scoreConfigs?: { scoreConfigId: string; version: number }[];
}

const base = (org: string) => `/api/${org}/annotation_queues`;

// (entityId@version) -> immutable score-config row ID. Populated by the
// catalog request and consumed by create().
const rowIdIndex = new Map<string, string>();

function unwrapList(data: any, key = "list"): any[] {
  if (Array.isArray(data)) return data;
  return Array.isArray(data?.[key]) ? data[key] : [];
}

function normalizedScoreValue(score: any): number | string | boolean | null {
  return (
    score.value_numeric ??
    score.valueNumeric ??
    score.value_categorical ??
    score.valueCategorical ??
    score.value_boolean ??
    score.valueBoolean ??
    null
  );
}

/** Fold a queue API row into the normalized shape. */
function normalizeQueue(q: any): LlmQueue {
  return {
    id: q.id,
    orgId: q.org_id ?? q.orgId,
    name: q.name,
    description: q.description ?? null,
    targetDatasetId: q.target_dataset_id ?? q.targetDatasetId ?? null,
    targetDatasetName: q.target_dataset_name ?? q.targetDatasetName ?? null,
    allowedRefTypes: Array.isArray(q.allowed_ref_types ?? q.allowedRefTypes)
      ? (q.allowed_ref_types ?? q.allowedRefTypes)
      : [],
    scoreConfigs: Array.isArray(q.score_configs ?? q.scoreConfigs)
      ? (q.score_configs ?? q.scoreConfigs).map((binding: any) => ({
          rowId: binding.row_id ?? binding.rowId ?? "",
          scoreConfigId:
            binding.entity_id ??
            binding.entityId ??
            binding.score_config_id ??
            binding.scoreConfigId ??
            "",
          name: binding.name ?? "",
          version: Number(binding.version ?? 1),
          dataType: (binding.data_type ?? binding.dataType ?? "numeric") as ScoreConfigDataType,
          latestVersion: binding.latest_version ?? binding.latestVersion,
        }))
      : [],
    reviewedCount: Number(q.reviewed_count ?? q.reviewedCount ?? 0),
    totalCount: Number(q.total_count ?? q.totalCount ?? 0),
    createdBy: q.created_by ?? q.createdBy,
    createdAt: q.created_at ?? q.createdAt,
    updatedBy: q.updated_by ?? q.updatedBy,
    updatedAt: q.updated_at ?? q.updatedAt,
  };
}

function normalizeItem(item: any): LlmQueueItem {
  return {
    id: item.id,
    queueId: item.queue_id ?? item.queueId,
    queueName: item.queue_name ?? item.queueName ?? null,
    refType: (item.ref_type ?? item.refType) as QueueRefType,
    refId: item.ref_id ?? item.refId,
    refTraceId: item.ref_trace_id ?? item.refTraceId ?? null,
    refTraceStartTime: Number(item.ref_trace_start_time ?? item.refTraceStartTime ?? 0),
    status: (item.status ?? "pending") as LlmQueueItemStatus,
    reviewedAt: item.reviewed_at ?? item.reviewedAt ?? null,
    archivedAt: item.archived_at ?? item.archivedAt ?? null,
    createdAt: Number(item.created_at ?? item.createdAt ?? 0),
    updatedAt: Number(item.updated_at ?? item.updatedAt ?? 0),
  };
}

function normalizeMachineScore(score: any): LlmQueueMachineScore {
  return {
    id: score.id,
    name: score.name ?? "",
    value: normalizedScoreValue(score),
    dataType: (score.data_type ?? score.dataType ?? "numeric") as ScoreConfigDataType,
    sourceType: score.source_type ?? score.sourceType ?? "",
    sourceStream: score.source_stream ?? score.sourceStream ?? null,
    reasoning: score.reasoning ?? null,
    timestamp: Number(score.timestamp ?? score._timestamp ?? 0),
  };
}

function normalizeItemDetail(detail: any): LlmQueueItemDetail {
  const content = detail.content ?? {};
  return {
    item: normalizeItem(detail.item ?? {}),
    sourceStream: detail.source_stream ?? detail.sourceStream ?? "",
    content: {
      input: content.input ?? null,
      output: content.output ?? null,
      trace: Array.isArray(content.trace) ? content.trace : [],
    },
    machineScores: unwrapList(detail.machine_scores ?? detail.machineScores).map(
      normalizeMachineScore,
    ),
    reviews: unwrapList(detail.reviews).map(normalizeReview),
  };
}

function normalizeReview(review: any): LlmQueueReview {
  const scores = Array.isArray(review.scores) ? review.scores : [];
  return {
    submissionId: review.submission_id ?? review.submissionId ?? "",
    reviewer: review.reviewer ?? null,
    comments: review.comments ?? null,
    submittedAt: Number(review.submitted_at ?? review.submittedAt ?? 0),
    scores: scores.map((score: any) => ({
      name: score.name ?? "",
      value: normalizedScoreValue(score),
    })),
  };
}

function versionDetails(row: any): LlmScoreConfigVersionDetails {
  const numericRange = row.numeric_range ?? row.numericRange;
  const min = Number(numericRange?.min);
  const max = Number(numericRange?.max);
  return {
    rowId: row.id,
    categories: Array.isArray(row.categories) ? row.categories.map(String) : undefined,
    numericRange:
      Number.isFinite(min) && Number.isFinite(max) && min < max ? { min, max } : undefined,
    healthyThreshold: row.healthy_threshold ?? row.healthyThreshold ?? undefined,
  };
}

const llmQueuesService = {
  async list(orgId: string): Promise<LlmQueue[]> {
    const res = await http().get(base(orgId));
    return unwrapList(res.data).map(normalizeQueue);
  },

  /**
   * The list endpoint returns only the latest active Score Config rows. Fetch
   * each logical config's versions endpoint so the queue form can pin any
   * immutable version and submit its physical row ID.
   */
  async listScoreConfigOptions(orgId: string): Promise<LlmScoreConfigOption[]> {
    const latestResponse = await http().get(`/api/${orgId}/score_configs`);
    const latestRows = unwrapList(latestResponse.data);
    const latestByEntity = new Map<string, any>();
    for (const row of latestRows) {
      const entityId = String(row.entity_id ?? row.entityId ?? row.id ?? "");
      if (entityId) latestByEntity.set(entityId, row);
    }

    rowIdIndex.clear();
    const options = await Promise.all(
      [...latestByEntity.entries()].map(async ([entityId, latestRow]) => {
        const versionsResponse = await http().get(
          `/api/${orgId}/score_configs/${encodeURIComponent(entityId)}/versions`,
        );
        const rows = unwrapList(versionsResponse.data, "versions");
        const allRows = rows.length ? rows : [latestRow];
        const uniqueRows = [...new Map(allRows.map((row: any) => [row.id, row])).values()];
        uniqueRows.sort((a: any, b: any) => Number(a.version) - Number(b.version));

        const details: Record<number, LlmScoreConfigVersionDetails> = {};
        for (const row of uniqueRows) {
          const version = Number(row.version ?? 1);
          details[version] = versionDetails(row);
          rowIdIndex.set(`${entityId}@${version}`, row.id);
        }

        const latestVersion = Math.max(...uniqueRows.map((row: any) => Number(row.version ?? 1)));
        const displayRow =
          uniqueRows.find((row: any) => Number(row.version ?? 1) === latestVersion) ?? latestRow;
        return {
          id: entityId,
          name: displayRow.name ?? latestRow.name ?? "",
          dataType: (displayRow.data_type ??
            displayRow.dataType ??
            latestRow.data_type ??
            latestRow.dataType ??
            "numeric") as ScoreConfigDataType,
          categories: details[latestVersion]?.categories,
          versions: uniqueRows.map((row: any) => Number(row.version ?? 1)),
          latestVersion,
          versionDetails: details,
        };
      }),
    );
    return options.sort((a, b) => a.name.localeCompare(b.name));
  },

  async get(orgId: string, queueId: string): Promise<LlmQueue | null> {
    const res = await http().get(`${base(orgId)}/${queueId}`);
    return res.data ? normalizeQueue(res.data) : null;
  },

  /** List active Queue Items, optionally restricted to one Queue. */
  async listItems(orgId: string, queueId?: string): Promise<LlmQueueItem[]> {
    const url = `${base(orgId)}/items`;
    const res = queueId
      ? await http().get(url, { params: { queue_id: queueId } })
      : await http().get(url);
    return unwrapList(res.data)
      .map(normalizeItem)
      .filter((item) => item.archivedAt === null);
  },

  async getItemDetail(
    orgId: string,
    queueId: string,
    queueItemId: string,
  ): Promise<LlmQueueItemDetail> {
    const res = await http().get(`${base(orgId)}/${queueId}/items/${queueItemId}`);
    return normalizeItemDetail(res.data);
  },

  async listReviews(
    orgId: string,
    queueId: string,
    queueItemId: string,
  ): Promise<LlmQueueReview[]> {
    const res = await http().get(`${base(orgId)}/${queueId}/items/${queueItemId}/reviews`);
    return unwrapList(res.data).map(normalizeReview);
  },

  async submitReview(
    orgId: string,
    queueId: string,
    queueItemId: string,
    payload: LlmQueueReviewPayload,
  ): Promise<LlmQueueReviewResult> {
    const res = await http().post(
      `${base(orgId)}/${queueId}/items/${queueItemId}/reviews`,
      payload,
    );
    return res.data;
  },

  /**
   * Distill a REVIEWED queue item into a dataset. The backend refuses anything
   * else: the item must be `reviewed` and un-archived, the submission id must
   * belong to it, and session-scope items are rejected outright (only a
   * trace/span reference can be hydrated back into a golden input).
   */
  async pushToDataset(
    orgId: string,
    queueId: string,
    queueItemId: string,
    payload: LlmDistillPayload,
  ): Promise<LlmDistillResult> {
    const res = await http().post(
      `${base(orgId)}/${queueId}/items/${queueItemId}/push_to_dataset`,
      {
        datasetId: payload.datasetId,
        reviewSubmissionId: payload.reviewSubmissionId,
        expectedOutput: payload.expectedOutput,
        tags: payload.tags ?? [],
      },
    );
    const item = res.data?.item ?? {};
    return {
      created: res.data?.created === true,
      datasetItemId: item.logicalId ?? item.logical_id ?? "",
    };
  },

  async create(orgId: string, payload: LlmQueuePayload): Promise<LlmQueue> {
    const requestedConfigs = payload.scoreConfigs ?? [];
    const scoreConfigRowIds = requestedConfigs.map((config) =>
      rowIdIndex.get(`${config.scoreConfigId}@${config.version}`),
    );
    if (scoreConfigRowIds.some((id) => !id)) {
      throw new Error("A selected Score Config version is no longer available");
    }
    const res = await http().post(base(orgId), {
      name: payload.name,
      description: payload.description ?? null,
      targetDatasetId: payload.targetDatasetId ?? null,
      scoreConfigRowIds: scoreConfigRowIds as string[],
    });
    return normalizeQueue(res.data);
  },
};

export default llmQueuesService;
