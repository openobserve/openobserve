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
  /** Free-form labels. Aggregated from the items' `tags` JSON (TODO(BE)). */
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

// Frontend-first: the `llm_datasets` schema exists but the HTTP API does not yet.
// Until it ships, VITE_LLM_ANNOTATION_MOCK (default ON) serves in-memory
// fixtures. Set it to "false" — a one-line swap — the moment the API lands; the
// views and components never change.
const USE_MOCK = import.meta.env.VITE_LLM_ANNOTATION_MOCK !== "false";

// TODO(BE): confirm the real path when the datasets API lands (existing eval
// endpoints are flat, e.g. `/api/{org}/score_configs`).
const base = (org: string) => `/api/${org}/llm/datasets`;

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

// ─── Mock backend (removed the day VITE_LLM_ANNOTATION_MOCK flips to false) ──
let mockSeq = 4;
const mockDatasets: LlmDataset[] = [
  {
    id: "ds_mock_1",
    name: "RAG regression set",
    description: "Retrieval-augmented answers graded for faithfulness against the source docs.",
    globalVersion: 214,
    itemCount: 128,
    tags: ["rag", "faithfulness", "retrieval"],
    sources: { trace: 88, annotation: 34, manual: 6 },
    createdBy: "priya@openobserve.ai",
    createdAt: Date.now() - 1000 * 60 * 60 * 24 * 21,
    updatedAt: Date.now() - 1000 * 60 * 60 * 2,
  },
  {
    id: "ds_mock_2",
    name: "Refund-policy goldens",
    description: "Support replies about refunds, reviewed for policy accuracy.",
    globalVersion: 96,
    itemCount: 64,
    tags: ["refund", "policy", "support"],
    sources: { trace: 40, annotation: 20, manual: 4 },
    createdBy: "sam@openobserve.ai",
    createdAt: Date.now() - 1000 * 60 * 60 * 24 * 9,
    updatedAt: Date.now() - 1000 * 60 * 60 * 24,
  },
  {
    id: "ds_mock_3",
    name: "Hallucination goldens",
    description: "Grounding checks for answers that must cite retrieved context.",
    globalVersion: 12,
    itemCount: 6,
    tags: ["hallucination", "grounding"],
    sources: { trace: 3, annotation: 2, manual: 1 },
    createdBy: "you@openobserve.ai",
    createdAt: Date.now() - 1000 * 60 * 60 * 24 * 4,
    updatedAt: Date.now() - 1000 * 60 * 60 * 3,
  },
  {
    id: "ds_mock_4",
    name: "Tool-call accuracy",
    description: "Agent tool invocations checked for correct tool and argument selection.",
    globalVersion: 30,
    itemCount: 22,
    tags: ["tool-call", "agent", "args"],
    sources: { trace: 18, annotation: 2, manual: 2 },
    createdBy: "sam@openobserve.ai",
    createdAt: Date.now() - 1000 * 60 * 60 * 24 * 12,
    updatedAt: Date.now() - 1000 * 60 * 60 * 24 * 5,
  },
];

const withLatency = <T>(value: T): Promise<T> =>
  new Promise((resolve) => setTimeout(() => resolve(value), 250));

const llmDatasetsService = {
  async list(orgId: string): Promise<LlmDataset[]> {
    if (USE_MOCK) return withLatency(mockDatasets.map(normalize));
    const res = await http().get(base(orgId));
    const rows = Array.isArray(res.data) ? res.data : (res.data?.list ?? []);
    return rows.map(normalize);
  },

  async create(orgId: string, payload: LlmDatasetPayload): Promise<LlmDataset> {
    if (USE_MOCK) {
      const now = Date.now();
      const row: LlmDataset = {
        id: `ds_mock_${++mockSeq}`,
        name: payload.name,
        description: payload.description?.trim() ? payload.description.trim() : null,
        globalVersion: 0,
        itemCount: 0,
        tags: payload.tags ?? [],
        sources: { trace: 0, annotation: 0, manual: 0 },
        createdBy: "you@openobserve.ai",
        createdAt: now,
        updatedAt: now,
      };
      mockDatasets.unshift(row);
      return withLatency(row);
    }
    const res = await http().post(base(orgId), payload);
    return normalize(res.data);
  },
};

export default llmDatasetsService;
