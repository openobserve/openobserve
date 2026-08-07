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

// ─── LLM Annotation · Datasets ──────────────────────────────────────────────
// Golden datasets are the append-only (MVCC) store the annotation workflow feeds
// into. This service mirrors the `llm_datasets` schema landed on the backend
// branch; the list view consumes ONLY the normalized (camelCase) shape below so
// the eventual snake_case API response is absorbed here, not in the UI.

/** Per-source item counts. Aggregated from `llm_dataset_items.source`. */
export interface LlmDatasetSourceCounts {
  trace: number;
  annotation: number;
  manual: number;
}

/** One golden dataset (normalized). Mirrors the `llm_datasets` table. */
export interface LlmDataset {
  id: string;
  orgId?: string;
  name: string;
  description: string | null;
  /** Dataset-wide MVCC sequence — bumped on every item insert/edit/delete. */
  globalVersion: number;
  /** Count of live (non-deleted) items. Derived server-side; 0 until wired. */
  itemCount: number;
  /** User-authored labels stored on the Dataset itself. */
  tags: string[];
  /** Live-item counts by origin. Aggregated from `source` (TODO(BE)). */
  sources: LlmDatasetSourceCounts;
  createdBy?: string;
  createdAt?: number;
  updatedBy?: string;
  updatedAt?: number;
}

/** Create/update payload. Only user-authored fields; the rest are server-owned. */
export interface LlmDatasetPayload {
  name: string;
  description?: string | null;
  tags?: string[];
}

/** Where a golden item came from. Mirrors `llm_dataset_items.source`. */
export type LlmDatasetItemSource = "trace" | "annotation" | "manual";

/** One golden item (input → expected_output), normalized. MVCC: editing an
 *  item's expected_output appends a new version rather than mutating in place. */
export interface LlmDatasetItem {
  /** Stable logical identity shared by every immutable version. */
  id: string;
  /** Physical identity of this specific immutable version. */
  rowId?: string;
  datasetId: string;
  /** Sanitized input (model_name/tokens/logprobs stripped) — "purified". */
  input: string;
  /** The golden answer. Required and never empty. */
  expectedOutput: string;
  source: LlmDatasetItemSource;
  tags: string[];
  /** Dataset-global MVCC version assigned to this immutable item row. */
  version: number;
  isDeleted?: boolean;
  /** Lineage pointer to the review/trace this golden was distilled from. */
  distilledFrom?: string | null;
  updatedAt?: number;
}

/** Add/edit-item payload. Only user-authored fields; version is server-owned. */
export interface LlmDatasetItemPayload {
  input: string;
  expectedOutput: string;
  source?: LlmDatasetItemSource;
  tags?: string[];
}

const base = (org: string) => `/api/${org}/datasets`;

/** Fold the API's snake_case (or already-camel) row into the normalized shape. */
function normalize(d: any): LlmDataset {
  return {
    id: d.id,
    orgId: d.org_id ?? d.orgId,
    name: d.name,
    description: d.description ?? null,
    globalVersion: d.global_version ?? d.globalVersion ?? 0,
    itemCount: d.item_count ?? d.itemCount ?? 0,
    tags: Array.isArray(d.tags) ? d.tags : [],
    sources: {
      trace: d.sources?.trace ?? d.source_trace ?? 0,
      annotation: d.sources?.annotation ?? d.source_annotation ?? 0,
      manual: d.sources?.manual ?? d.source_manual ?? 0,
    },
    createdBy: d.created_by ?? d.createdBy,
    createdAt: d.created_at ?? d.createdAt,
    updatedBy: d.updated_by ?? d.updatedBy,
    updatedAt: d.updated_at ?? d.updatedAt,
  };
}

/** Fold an API item row into the normalized shape. */
function normalizeItem(d: any): LlmDatasetItem {
  return {
    id: d.logical_id ?? d.logicalId ?? d.id,
    rowId: d.row_id ?? d.rowId,
    datasetId: d.dataset_id ?? d.datasetId,
    input: d.input ?? "",
    expectedOutput: d.expected_output ?? d.expectedOutput ?? "",
    source: (d.source ?? "manual") as LlmDatasetItemSource,
    tags: Array.isArray(d.tags) ? d.tags : [],
    version: d.global_version ?? d.globalVersion ?? d.version ?? 1,
    isDeleted: d.is_deleted ?? d.isDeleted ?? false,
    distilledFrom: d.source_ref ?? d.sourceRef ?? d.distilled_from ?? d.distilledFrom ?? null,
    updatedAt: d.updated_at ?? d.updatedAt,
  };
}

// Mock golden items, keyed by dataset. Faithful to the "input (purified) →
// expected_output, source, tags, version" shape the detail view renders.
let mockItemSeq = 100;
const mockItems: Record<string, LlmDatasetItem[]> = {
  ds_mock_1: [
    {
      id: "it_1",
      datasetId: "ds_mock_1",
      input: "Customer wants to return a red T-shirt bought yesterday — is it eligible?",
      expectedOutput:
        "Hello! Order SH202604280912 is within the 7-day no-questions-asked window, so the red T-shirt is eligible for a full refund.",
      source: "annotation",
      tags: ["refund"],
      version: 2,
      distilledFrom: "queue:hallucination/trace-000021",
      updatedAt: Date.now() - 1000 * 60 * 60 * 2,
    },
    {
      id: "it_2",
      datasetId: "ds_mock_1",
      input: "What is the capital of France according to the retrieved records?",
      expectedOutput:
        "Based on the retrieved records, the relevant administrative capital is Paris.",
      source: "trace",
      tags: ["faithfulness", "rag"],
      version: 3,
      updatedAt: Date.now() - 1000 * 60 * 60 * 6,
    },
    {
      id: "it_3",
      datasetId: "ds_mock_1",
      input: "Summarize the key recommendations from the attached compliance report.",
      expectedOutput:
        "The report's key recommendations are: (1) enforce mandatory review gates, (2) rotate access keys quarterly, and (3) log all privileged actions.",
      source: "trace",
      tags: ["summarization", "compliance"],
      version: 3,
      updatedAt: Date.now() - 1000 * 60 * 60 * 24,
    },
    {
      id: "it_4",
      datasetId: "ds_mock_1",
      input: "Can I still get a refund after 30 days?",
      expectedOutput:
        "Beyond 30 days is normally outside the standard refund window and requires manual review — it is not auto-approved.",
      source: "annotation",
      tags: ["refund", "policy"],
      version: 1,
      distilledFrom: "queue:refund-policy/trace-000048",
      updatedAt: Date.now() - 1000 * 60 * 60 * 24 * 2,
    },
    {
      id: "it_5",
      datasetId: "ds_mock_1",
      input: "Retrieve and ground: which clauses cover liability caps?",
      expectedOutput:
        "Liability caps are governed by Section 9.2 (Limitation of Liability) of the master agreement.",
      source: "trace",
      tags: ["rag", "legal"],
      version: 1,
      updatedAt: Date.now() - 1000 * 60 * 60 * 24 * 3,
    },
    {
      id: "it_6",
      datasetId: "ds_mock_1",
      input: "Can I use points to offset the shipping fee?",
      expectedOutput:
        "Yes. Points can offset shipping at 100 points = $1; check your balance at checkout.",
      source: "manual",
      tags: ["points"],
      version: 1,
      updatedAt: Date.now() - 1000 * 60 * 60 * 24 * 4,
    },
  ],
};

// Datasets without hand-authored fixtures get a small generated pool so the
// detail view is populated for every row.
function generatedItems(datasetId: string, count: number): LlmDatasetItem[] {
  const sources: LlmDatasetItemSource[] = ["trace", "annotation", "manual"];
  return Array.from({ length: Math.min(count, 8) }, (_, i) => ({
    id: `${datasetId}_gen_${i + 1}`,
    datasetId,
    input: `Sample input ${i + 1} for this dataset.`,
    expectedOutput: `Expected golden answer ${i + 1}.`,
    source: sources[i % sources.length],
    tags: i % 2 === 0 ? ["sample"] : [],
    version: 1,
    updatedAt: Date.now() - 1000 * 60 * 60 * (i + 1),
  }));
}

const withLatency = <T>(value: T): Promise<T> =>
  new Promise((resolve) => setTimeout(() => resolve(value), 250));

const llmDatasetsService = {
  // Dataset-level CRUD is bound to the real API. The response has no
  // itemCount/sources yet, so normalize() defaults those aggregates.
  async list(orgId: string): Promise<LlmDataset[]> {
    const res = await http().get(base(orgId));
    const rows = Array.isArray(res.data) ? res.data : (res.data?.list ?? []);
    return rows.map(normalize);
  },

  async get(orgId: string, id: string): Promise<LlmDataset> {
    const res = await http().get(`${base(orgId)}/${id}`);
    return normalize(res.data);
  },

  // TODO(BE): no list-dataset-items endpoint yet. Items stay on in-memory mock
  // until the API lands; the whole item subsystem (list/add/edit/delete) is mock
  // for consistency (add/edit/delete item endpoints are also incomplete).
  async listItems(_orgId: string, datasetId: string): Promise<LlmDatasetItem[]> {
    const items = mockItems[datasetId] ?? generatedItems(datasetId, 6);
    return withLatency(items.map(normalizeItem));
  },

  async getItemVersions(
    orgId: string,
    datasetId: string,
    itemId: string,
  ): Promise<LlmDatasetItem[]> {
    const res = await http().get(`${base(orgId)}/${datasetId}/items/${itemId}`);
    const rows = Array.isArray(res.data) ? res.data : (res.data?.list ?? []);
    return rows.map(normalizeItem);
  },

  async update(orgId: string, id: string, payload: LlmDatasetPayload): Promise<LlmDataset> {
    const res = await http().put(`${base(orgId)}/${id}`, {
      name: payload.name,
      description: payload.description ?? null,
      tags: payload.tags ?? [],
    });
    return normalize(res.data);
  },

  async remove(orgId: string, id: string): Promise<void> {
    await http().delete(`${base(orgId)}/${id}`);
  },

  // Item mutations stay on mock (see listItems TODO(BE) above).
  async addItem(
    _orgId: string,
    datasetId: string,
    payload: LlmDatasetItemPayload,
  ): Promise<LlmDatasetItem> {
    const row: LlmDatasetItem = {
      id: `it_mock_${++mockItemSeq}`,
      datasetId,
      input: payload.input.trim(),
      expectedOutput: payload.expectedOutput.trim(),
      source: payload.source ?? "manual",
      tags: payload.tags ?? [],
      version: 1,
      distilledFrom: null,
      updatedAt: Date.now(),
    };
    (mockItems[datasetId] ??= []).unshift(row);
    return withLatency(normalizeItem(row));
  },

  /** Edit an item. MVCC: changing expected_output appends a new version. */
  async updateItem(
    _orgId: string,
    datasetId: string,
    itemId: string,
    payload: LlmDatasetItemPayload,
  ): Promise<LlmDatasetItem> {
    const pool = mockItems[datasetId] ?? [];
    const row = pool.find((it) => it.id === itemId);
    if (!row) throw new Error("item not found");
    const answerChanged = row.expectedOutput !== payload.expectedOutput.trim();
    row.input = payload.input.trim();
    row.expectedOutput = payload.expectedOutput.trim();
    if (payload.tags) row.tags = payload.tags;
    if (answerChanged) row.version += 1;
    row.updatedAt = Date.now();
    return withLatency(normalizeItem(row));
  },

  async removeItem(_orgId: string, datasetId: string, itemId: string): Promise<void> {
    const pool = mockItems[datasetId];
    if (pool) {
      const idx = pool.findIndex((it) => it.id === itemId);
      if (idx >= 0) pool.splice(idx, 1);
    }
    return withLatency(undefined);
  },

  async create(orgId: string, payload: LlmDatasetPayload): Promise<LlmDataset> {
    const res = await http().post(base(orgId), {
      name: payload.name,
      description: payload.description ?? null,
      tags: payload.tags ?? [],
    });
    return normalize(res.data);
  },
};

export default llmDatasetsService;
