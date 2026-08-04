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
// A queue is a stateful review to-do list: it binds one or more Score Configs,
// a target dataset, and a filter that feeds it. This service mirrors the
// `llm_annotation_queues` / `_queue_bindings` / `_queue_items` schema landed on
// the backend branch; the list view consumes ONLY the normalized shape below.

/** One bound Score Config version (from `llm_annotation_queue_bindings`). */
export interface LlmQueueBinding {
  /** Logical Score Config identity (stable across versions). */
  scoreConfigId: string;
  name: string;
  /** The exact bound version. */
  version: number;
  /** Latest available version — drives the "vN available" upgrade hint. */
  latestVersion?: number;
}

/** Comparison operator for an auto-routing condition. */
export type AutoRouteOperator = "<" | "<=" | ">" | ">=" | "==" | "!=";

/** One auto-routing rule: an object's score on `scoreConfigId` vs `value`.
 *  `value` is a number for numeric configs, else the category / boolean string. */
export interface AutoRouteCondition {
  scoreConfigId: string;
  operator: AutoRouteOperator;
  value: number | string;
}

/** Auto-routing — enqueue objects whose scores match these conditions. */
export interface AutoRouting {
  /** Whether ALL conditions must match, or ANY. */
  matchMode: "all" | "any";
  conditions: AutoRouteCondition[];
}

/** One review queue (normalized). Mirrors `llm_annotation_queues`. */
export interface LlmQueue {
  id: string;
  orgId?: string;
  name: string;
  description: string | null;
  /** Target dataset the reviewed items feed into. */
  targetDatasetId: string | null;
  /** Resolved dataset name for display (TODO(BE): join server-side). */
  targetDatasetName: string | null;
  /** Server-owned subset of session | trace | span the queue accepts. */
  allowedRefTypes: string[];
  /** Bound Score Config versions (from `_queue_bindings`). */
  scoreConfigs: LlmQueueBinding[];
  /** Reviewed / total item counts (aggregated from `_queue_items.status`). */
  reviewedCount: number;
  totalCount: number;
  /** Auto-routing rules that feed this queue (null = fed manually). */
  autoRouting?: AutoRouting | null;
  createdBy?: string;
  createdAt?: number;
  updatedBy?: string;
  updatedAt?: number;
}

/** The dimension type a Score Config scores on. */
export type ScoreConfigDataType = "numeric" | "categorical" | "boolean";

/** A Score Config available to bind, with its selectable versions. */
export interface LlmScoreConfigOption {
  id: string;
  name: string;
  dataType: ScoreConfigDataType;
  /** Allowed values when `dataType` is "categorical". */
  categories?: string[];
  versions: number[];
  latestVersion: number;
}

/** A single item in a queue's review pool. Mirrors `llm_annotation_queue_items`.
 *  Per the Phase-2.5 spec, status is `pending` | `reviewed` ONLY — there is no
 *  "in review" state (the all-or-nothing submit rule eliminates it); `archived`
 *  is orthogonal (via `archivedAt`). */
export type LlmQueueItemStatus = "pending" | "reviewed";
export type QueueRefType = "session" | "trace" | "span";

export interface LlmQueueItem {
  id: string;
  queueId: string;
  refType: QueueRefType;
  refId: string;
  refTraceId: string | null;
  status: LlmQueueItemStatus;
  reviewedAt: number | null;
  archivedAt: number | null;
  createdAt: number;
}

/** Create/update payload. Only user-authored fields; the rest are server-owned. */
export interface LlmQueuePayload {
  name: string;
  description?: string | null;
  targetDatasetId?: string | null;
  /** Display convenience for the mock; the backend resolves this server-side. */
  targetDatasetName?: string | null;
  /** Bound Score Config versions (id + pinned version). */
  scoreConfigs?: { scoreConfigId: string; version: number }[];
  /** Auto-routing rules (null/omitted = fed manually). */
  autoRouting?: AutoRouting | null;
}

// Shares the annotation-area mock flag with llm-datasets.service.ts. Default ON
// until the HTTP API ships; set VITE_LLM_ANNOTATION_MOCK="false" to go live.
const USE_MOCK = import.meta.env.VITE_LLM_ANNOTATION_MOCK !== "false";

// TODO(BE): confirm the real path when the queues API lands.
const base = (org: string) => `/api/${org}/llm/annotation_queues`;

/** Fold the API's snake_case (or already-camel) row into the normalized shape. */
function normalize(q: any): LlmQueue {
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
      ? (q.score_configs ?? q.scoreConfigs).map((b: any) => ({
          scoreConfigId: b.score_config_id ?? b.scoreConfigId,
          name: b.name,
          version: b.version ?? 1,
          latestVersion: b.latest_version ?? b.latestVersion,
        }))
      : [],
    reviewedCount: q.reviewed_count ?? q.reviewedCount ?? 0,
    totalCount: q.total_count ?? q.totalCount ?? 0,
    autoRouting: q.auto_routing ?? q.autoRouting ?? null,
    createdBy: q.created_by ?? q.createdBy,
    createdAt: q.created_at ?? q.createdAt,
    updatedBy: q.updated_by ?? q.updatedBy,
    updatedAt: q.updated_at ?? q.updatedAt,
  };
}

// ─── Mock backend (removed the day VITE_LLM_ANNOTATION_MOCK flips to false) ──
// The Score Config catalog the create form binds from. In production these come
// from `/api/{org}/score_configs` (deduped to logical id + versions).
const MOCK_SCORE_CONFIGS: LlmScoreConfigOption[] = [
  { id: "sc_faith", name: "faithfulness", dataType: "numeric", versions: [1, 2], latestVersion: 2 },
  {
    id: "sc_hall",
    name: "hallucination_severity",
    dataType: "categorical",
    categories: ["none", "minor", "major", "critical"],
    versions: [1],
    latestVersion: 1,
  },
  {
    id: "sc_ground",
    name: "grounded_in_context",
    dataType: "boolean",
    versions: [1],
    latestVersion: 1,
  },
  { id: "sc_pii", name: "pii_leak", dataType: "boolean", versions: [1], latestVersion: 1 },
  {
    id: "sc_policy",
    name: "policy_violation",
    dataType: "categorical",
    categories: ["none", "minor", "major"],
    versions: [1, 2],
    latestVersion: 2,
  },
  {
    id: "sc_recall",
    name: "context_recall",
    dataType: "numeric",
    versions: [1],
    latestVersion: 1,
  },
  { id: "sc_chunk", name: "missing_chunk", dataType: "boolean", versions: [1], latestVersion: 1 },
  {
    id: "sc_tone",
    name: "tone_appropriateness",
    dataType: "categorical",
    categories: ["poor", "ok", "good"],
    versions: [1],
    latestVersion: 1,
  },
];

let mockSeq = 3;
const mockQueues: LlmQueue[] = [
  {
    id: "q_mock_1",
    name: "Hallucination queue",
    description: "Faithfulness failures surfaced from Discovery — RAG answers drifting from retrieved context.",
    targetDatasetId: "ds_mock_3",
    targetDatasetName: "Hallucination goldens",
    allowedRefTypes: ["trace", "span"],
    scoreConfigs: [
      { scoreConfigId: "sc_faith", name: "faithfulness", version: 2, latestVersion: 2 },
      { scoreConfigId: "sc_hall", name: "hallucination_severity", version: 1, latestVersion: 1 },
      { scoreConfigId: "sc_ground", name: "grounded_in_context", version: 1, latestVersion: 1 },
    ],
    reviewedCount: 8,
    totalCount: 47,
    createdBy: "priya@openobserve.ai",
    createdAt: Date.now() - 1000 * 60 * 60 * 24 * 14,
    updatedAt: Date.now() - 1000 * 60 * 60 * 2,
  },
  {
    id: "q_mock_2",
    name: "Compliance queue",
    description: "Regulated-content sessions flagged for human compliance review before release.",
    targetDatasetId: "ds_mock_2",
    targetDatasetName: "Refund-policy goldens",
    allowedRefTypes: ["session"],
    scoreConfigs: [
      { scoreConfigId: "sc_pii", name: "pii_leak", version: 1, latestVersion: 1 },
      { scoreConfigId: "sc_policy", name: "policy_violation", version: 1, latestVersion: 2 },
    ],
    reviewedCount: 21,
    totalCount: 35,
    createdBy: "sam@openobserve.ai",
    createdAt: Date.now() - 1000 * 60 * 60 * 24 * 20,
    updatedAt: Date.now() - 1000 * 60 * 60 * 24 * 3,
  },
  {
    id: "q_mock_3",
    name: "RAG-recall queue",
    description: "Retrieval spans where recall looked low — checking the chunks actually fed to the model.",
    targetDatasetId: "ds_mock_1",
    targetDatasetName: "RAG regression set",
    allowedRefTypes: ["span"],
    scoreConfigs: [
      { scoreConfigId: "sc_recall", name: "context_recall", version: 1, latestVersion: 1 },
      { scoreConfigId: "sc_chunk", name: "missing_chunk", version: 1, latestVersion: 1 },
    ],
    reviewedCount: 64,
    totalCount: 64,
    createdBy: "you@openobserve.ai",
    createdAt: Date.now() - 1000 * 60 * 60 * 24 * 30,
    updatedAt: Date.now() - 1000 * 60 * 60 * 24 * 7,
  },
];

const withLatency = <T>(value: T): Promise<T> =>
  new Promise((resolve) => setTimeout(() => resolve(value), 250));

const llmQueuesService = {
  async list(orgId: string): Promise<LlmQueue[]> {
    if (USE_MOCK) return withLatency(mockQueues.map(normalize));
    const res = await http().get(base(orgId));
    const rows = Array.isArray(res.data) ? res.data : (res.data?.list ?? []);
    return rows.map(normalize);
  },

  /** Score Configs available to bind in the create form (id + versions). */
  async listScoreConfigOptions(orgId: string): Promise<LlmScoreConfigOption[]> {
    if (USE_MOCK) return withLatency(MOCK_SCORE_CONFIGS.map((c) => ({ ...c })));
    // TODO(BE): dedupe `/api/{org}/score_configs` rows to logical id + versions.
    const res = await http().get(`/api/${orgId}/score_configs`);
    const rows = Array.isArray(res.data) ? res.data : (res.data?.list ?? []);
    return rows.map((r: any) => ({
      id: r.entity_id ?? r.id,
      name: r.name,
      versions: [r.version ?? 1],
      latestVersion: r.version ?? 1,
    }));
  },

  async get(orgId: string, queueId: string): Promise<LlmQueue | null> {
    if (USE_MOCK) {
      const found = mockQueues.find((q) => q.id === queueId) ?? null;
      return withLatency(found ? normalize(found) : null);
    }
    const res = await http().get(`${base(orgId)}/${queueId}`);
    return res.data ? normalize(res.data) : null;
  },

  /** The queue's review pool. Pending items are ordered first (the to-do). */
  async listItems(orgId: string, queueId: string): Promise<LlmQueueItem[]> {
    if (USE_MOCK) {
      const q = mockQueues.find((x) => x.id === queueId);
      if (!q) return withLatency([]);
      const refType = (q.allowedRefTypes[0] as QueueRefType) ?? "trace";
      const pendingCount = q.totalCount - q.reviewedCount;
      const hex = (n: number, len: number) => n.toString(16).padStart(len, "0");
      const items: LlmQueueItem[] = Array.from({ length: q.totalCount }, (_, i) => {
        const reviewed = i >= pendingCount; // last `reviewedCount` are reviewed
        return {
          id: `${queueId}_item_${i + 1}`,
          queueId,
          refType,
          refId: `${refType}-${hex(i + 1, 6)}`,
          refTraceId: `trace-${hex(i + 1, 8)}`,
          status: reviewed ? "reviewed" : "pending",
          reviewedAt: reviewed ? Date.now() - (q.totalCount - i) * 3_600_000 : null,
          archivedAt: null,
          createdAt: Date.now() - (q.totalCount - i) * 7_200_000,
        };
      });
      return withLatency(items);
    }
    const res = await http().get(`${base(orgId)}/${queueId}/items`);
    const rows = Array.isArray(res.data) ? res.data : (res.data?.list ?? []);
    return rows.map((r: any) => ({
      id: r.id,
      queueId: r.queue_id ?? r.queueId ?? queueId,
      refType: r.ref_type ?? r.refType,
      refId: r.ref_id ?? r.refId,
      refTraceId: r.ref_trace_id ?? r.refTraceId ?? null,
      status: r.status,
      reviewedAt: r.reviewed_at ?? r.reviewedAt ?? null,
      archivedAt: r.archived_at ?? r.archivedAt ?? null,
      createdAt: r.created_at ?? r.createdAt ?? 0,
    }));
  },

  async create(orgId: string, payload: LlmQueuePayload): Promise<LlmQueue> {
    if (USE_MOCK) {
      const now = Date.now();
      const row: LlmQueue = {
        id: `q_mock_${++mockSeq}`,
        name: payload.name,
        description: payload.description?.trim() ? payload.description.trim() : null,
        targetDatasetId: payload.targetDatasetId ?? null,
        targetDatasetName: payload.targetDatasetName ?? null,
        allowedRefTypes: [],
        scoreConfigs: (payload.scoreConfigs ?? []).map((b) => {
          const cat = MOCK_SCORE_CONFIGS.find((c) => c.id === b.scoreConfigId);
          return {
            scoreConfigId: b.scoreConfigId,
            name: cat?.name ?? b.scoreConfigId,
            version: b.version,
            latestVersion: cat?.latestVersion,
          };
        }),
        autoRouting: payload.autoRouting ?? null,
        reviewedCount: 0,
        totalCount: 0,
        createdBy: "you@openobserve.ai",
        createdAt: now,
        updatedAt: now,
      };
      mockQueues.unshift(row);
      return withLatency(row);
    }
    const res = await http().post(base(orgId), payload);
    return normalize(res.data);
  },
};

export default llmQueuesService;
