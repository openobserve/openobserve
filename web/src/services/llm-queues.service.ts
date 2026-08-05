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

const base = (org: string) => `/api/${org}/annotation_queues`;

// (entityId@version) → score-config ROW id. Populated by listScoreConfigOptions
// and read by create() to send `scoreConfigRowIds` (what the API binds by).
const rowIdIndex = new Map<string, string>();

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
          // Real binding = PinnedScoreConfigResponseBody{rowId, entityId, name, version, dataType}.
          scoreConfigId: b.entity_id ?? b.entityId ?? b.score_config_id ?? b.scoreConfigId,
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


const withLatency = <T>(value: T): Promise<T> =>
  new Promise((resolve) => setTimeout(() => resolve(value), 250));

const llmQueuesService = {
  // Queue list/get/create bound to the real API. The response has no progress
  // counts (reviewedCount/totalCount) — normalize defaults them to 0 (TODO(BE)).
  async list(orgId: string): Promise<LlmQueue[]> {
    const res = await http().get(base(orgId));
    const rows = Array.isArray(res.data) ? res.data : (res.data?.list ?? []);
    return rows.map(normalize);
  },

  /**
   * Score Configs available to bind in the create form. The API returns one flat
   * row per (entity, version); we group by logical entity id and remember each
   * version's ROW id (`scoreConfigRowIds` is what create/update actually send).
   */
  async listScoreConfigOptions(orgId: string): Promise<LlmScoreConfigOption[]> {
    const res = await http().get(`/api/${orgId}/score_configs`);
    const rows = Array.isArray(res.data) ? res.data : (res.data?.list ?? []);
    rowIdIndex.clear();
    const byEntity = new Map<string, LlmScoreConfigOption>();
    for (const r of rows) {
      const entityId = r.entity_id ?? r.entityId ?? r.id;
      const version = r.version ?? 1;
      rowIdIndex.set(`${entityId}@${version}`, r.id);
      const cats = Array.isArray(r.categories) ? r.categories : undefined;
      let opt = byEntity.get(entityId);
      if (!opt) {
        opt = {
          id: entityId,
          name: r.name,
          dataType: (r.data_type ?? r.dataType ?? "numeric") as ScoreConfigDataType,
          categories: cats,
          versions: [],
          latestVersion: version,
        };
        byEntity.set(entityId, opt);
      }
      opt.versions.push(version);
      if (version > opt.latestVersion) opt.latestVersion = version;
    }
    const options = [...byEntity.values()];
    options.forEach((o) => o.versions.sort((a, b) => a - b));
    return options;
  },

  async get(orgId: string, queueId: string): Promise<LlmQueue | null> {
    const res = await http().get(`${base(orgId)}/${queueId}`);
    return res.data ? normalize(res.data) : null;
  },

  /**
   * The queue's review pool. KEPT ON MOCK: the backend items endpoint is global
   * (no queue_id filter) and the review-submit path isn't wired yet, so the
   * Workbench runs on a self-contained mock pool (TODO(BE)).
   */
  async listItems(_orgId: string, queueId: string): Promise<LlmQueueItem[]> {
    const total = 47;
    const reviewedCount = 8;
    const pendingCount = total - reviewedCount;
    const hex = (n: number, len: number) => n.toString(16).padStart(len, "0");
    const items: LlmQueueItem[] = Array.from({ length: total }, (_, i) => {
      const reviewed = i >= pendingCount; // last `reviewedCount` are reviewed
      return {
        id: `${queueId}_item_${i + 1}`,
        queueId,
        refType: "trace" as QueueRefType,
        refId: `trace-${hex(i + 1, 6)}`,
        refTraceId: `trace-${hex(i + 1, 8)}`,
        status: reviewed ? "reviewed" : "pending",
        reviewedAt: reviewed ? Date.now() - (total - i) * 3_600_000 : null,
        archivedAt: null,
        createdAt: Date.now() - (total - i) * 7_200_000,
      };
    });
    return withLatency(items);
  },

  /**
   * Create a queue. The API binds Score Configs by their pinned-version ROW ids;
   * we resolve `{scoreConfigId(entityId), version}` → rowId via the cache
   * populated by listScoreConfigOptions (the create form always loads it first).
   * autoRouting/targetDatasetName are UI-only and dropped (deny_unknown_fields).
   */
  async create(orgId: string, payload: LlmQueuePayload): Promise<LlmQueue> {
    const scoreConfigRowIds = (payload.scoreConfigs ?? [])
      .map((c) => rowIdIndex.get(`${c.scoreConfigId}@${c.version}`))
      .filter((id): id is string => Boolean(id));
    const res = await http().post(base(orgId), {
      name: payload.name,
      description: payload.description ?? null,
      targetDatasetId: payload.targetDatasetId ?? null,
      scoreConfigRowIds,
    });
    return normalize(res.data);
  },
};

export default llmQueuesService;
