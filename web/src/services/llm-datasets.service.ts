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

/** One golden item (input → expected_output), normalized. MVCC: editing an item
 *  APPENDS a row carrying the same logical id and the next dataset version. */
export interface LlmDatasetItem {
  /** LOGICAL id — stable across versions, and what update/delete address. */
  id: string;
  /** Physical row id of this immutable version. */
  rowId: string;
  datasetId: string;
  /** Sanitized input as stored, flattened to text — what the edit form loads. */
  input: string;
  /** Same input with the message envelope unwrapped, for display. */
  inputPreview: string;
  /** The golden answer. Required and never empty. */
  expectedOutput: string;
  /** Untouched API values — re-sent verbatim when the text wasn't edited, so a
   *  structured input (a messages array) never collapses into a string. */
  rawInput: unknown;
  rawExpectedOutput: unknown;
  source: LlmDatasetItemSource;
  tags: string[];
  /** Dataset-wide MVCC sequence this row was written at (server-owned). */
  version: number;
  /** Free-form dimensions stored on the item — what subset filters read. */
  metadata: Record<string, unknown> | null;
  /** Lineage — the trace id a telemetry-pushed golden was distilled from. */
  sourceRef: string | null;
  /** Lineage — the span inside `sourceRef`. Set for trace pushes too (the root
   *  span), so it never on its own means "this was a span push". */
  sourceSpanId: string | null;
  /** Lineage — the queue review this golden was adjudicated from. */
  reviewSubmissionId: string | null;
  /** Lineage — the CSV this golden was imported from. */
  importFilename: string | null;
  isDeleted: boolean;
  updatedBy?: string;
  updatedAt?: number;
}

/** Add/edit-item payload. `input`/`expectedOutput` are JSON values server-side,
 *  so they stay `unknown` here: the UI sends text, lineage-bearing rows re-send
 *  their original structure. */
export interface LlmDatasetItemPayload {
  input: unknown;
  expectedOutput: unknown;
  tags?: string[];
  metadata?: Record<string, unknown> | null;
}

/** Telemetry push payload — a trace/span reference plus the human's golden. */
export interface LlmTelemetryItemPayload {
  refType: "trace" | "span";
  refId: string;
  sourceStream: string;
  /** Positive lower bound used to retrieve the reference, in MICROSECONDS. */
  refTraceStartTime: number;
  expectedOutput: string;
  tags?: string[];
  metadata?: Record<string, unknown> | null;
}

export interface LlmDatasetItemPage {
  items: LlmDatasetItem[];
  total: number;
  from: number;
  size: number;
  hasMore: boolean;
}

export interface ListDatasetItemsParams {
  from?: number;
  size?: number;
  /** Include the latest tombstone for deleted logical items. */
  includeDeleted?: boolean;
}

/** The items API's page-size ceiling (`size` is validated to 1..100). */
export const DATASET_ITEMS_MAX_PAGE_SIZE = 100;

const base = (org: string) => `/api/${org}/datasets`;
const itemsBase = (org: string, datasetId: string) => `${base(org)}/${datasetId}/items`;

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

/** Human-readable view of a message payload. The API stores the trace's
 *  `gen_ai_input_messages` verbatim, so a simple prompt arrives as
 *  `[{"role":"user","content":"…"}]`. Roles matter for multi-turn inputs, so the
 *  stored value is never rewritten — but a single message reads as its content.
 */
function messageText(value: unknown): string | null {
  const messages = Array.isArray(value) ? value : null;
  if (!messages?.length) return null;
  const parts = messages
    .filter((m: any) => m && typeof m === "object" && typeof m.content === "string")
    .map((m: any) => (messages.length > 1 ? `${m.role ?? "message"}: ${m.content}` : m.content));
  return parts.length === messages.length ? parts.join("\n") : null;
}

/** A JSON value rendered as one line of text for the table and the edit form. */
function itemText(value: unknown): string {
  if (value == null) return "";
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value);
  } catch {
    return "";
  }
}

/** `metadata` is arbitrary JSON server-side; the UI only renders object shapes. */
function objectOrNull(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

/** Fold an API item row into the normalized shape. The row's `id` is the LOGICAL
 *  id — `rowId` identifies this one immutable version and is never sent back. */
function normalizeItem(d: any): LlmDatasetItem {
  const input = d.input ?? null;
  const expectedOutput = d.expectedOutput ?? d.expected_output ?? null;
  return {
    id: d.logicalId ?? d.logical_id ?? d.id ?? "",
    rowId: d.rowId ?? d.row_id ?? "",
    datasetId: d.datasetId ?? d.dataset_id ?? "",
    input: itemText(input),
    inputPreview: messageText(input) ?? itemText(input),
    expectedOutput: itemText(expectedOutput),
    rawInput: input,
    rawExpectedOutput: expectedOutput,
    source: (d.source ?? "manual") as LlmDatasetItemSource,
    tags: Array.isArray(d.tags) ? d.tags : [],
    version: Number(d.globalVersion ?? d.global_version ?? 0),
    metadata: objectOrNull(d.metadata),
    // Lineage stays as FOUR separate pointers: an annotation push carries both a
    // trace ref and a review submission, so collapsing them loses half the story.
    sourceRef: d.sourceRef ?? d.source_ref ?? null,
    sourceSpanId: d.sourceSpanId ?? d.source_span_id ?? null,
    reviewSubmissionId: d.reviewSubmissionId ?? d.review_submission_id ?? null,
    importFilename: d.importFilename ?? d.import_filename ?? null,
    isDeleted: (d.isDeleted ?? d.is_deleted) === true,
    updatedBy: d.updatedBy ?? d.updated_by,
    updatedAt: d.updatedAt ?? d.updated_at,
  };
}

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

  /** Current snapshot: the latest row per logical item, tombstones excluded
   *  unless `includeDeleted`. Paged server-side (size 1..100, default 20). */
  async listItems(
    orgId: string,
    datasetId: string,
    params: ListDatasetItemsParams = {},
  ): Promise<LlmDatasetItemPage> {
    const res = await http().get(itemsBase(orgId, datasetId), {
      params: {
        from: params.from ?? 0,
        size: Math.min(params.size ?? 20, DATASET_ITEMS_MAX_PAGE_SIZE),
        includeDeleted: params.includeDeleted ?? false,
      },
    });
    const data = res.data ?? {};
    const list = Array.isArray(data.list) ? data.list : [];
    return {
      items: list.map(normalizeItem),
      total: Number(data.total ?? list.length),
      from: Number(data.from ?? 0),
      size: Number(data.size ?? list.length),
      hasMore: data.hasMore === true,
    };
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

  /** Add a golden straight from a trace or span. The server re-reads and
   *  purifies the input from this immutable reference — the human only supplies
   *  the expected output, which is why `input` is absent from the payload. */
  async addTelemetryItem(
    orgId: string,
    datasetId: string,
    payload: LlmTelemetryItemPayload,
  ): Promise<LlmDatasetItem> {
    const res = await http().post(itemsBase(orgId, datasetId), {
      entryPoint: "telemetry",
      refType: payload.refType,
      refId: payload.refId,
      sourceStream: payload.sourceStream,
      refTraceStartTime: payload.refTraceStartTime,
      expectedOutput: payload.expectedOutput,
      metadata: payload.metadata ?? null,
      tags: payload.tags ?? [],
    });
    return normalizeItem(res.data?.item ?? res.data);
  },

  /** Add a user-authored golden. The push endpoint is a tagged union; the UI
   *  only ever writes the `manual` entry point (telemetry pushes come from the
   *  trace detail views, which carry an immutable trace/span reference). */
  async addItem(
    orgId: string,
    datasetId: string,
    payload: LlmDatasetItemPayload,
  ): Promise<LlmDatasetItem> {
    const res = await http().post(itemsBase(orgId, datasetId), {
      entryPoint: "manual",
      input: payload.input,
      expectedOutput: payload.expectedOutput,
      metadata: payload.metadata ?? null,
      tags: payload.tags ?? [],
    });
    return normalizeItem(res.data?.item ?? res.data);
  },

  /** Edit an item. MVCC: the server APPENDS a row with the same logical id and
   *  the next dataset version, so `itemId` here is the LOGICAL id. */
  async updateItem(
    orgId: string,
    datasetId: string,
    itemId: string,
    payload: LlmDatasetItemPayload,
  ): Promise<LlmDatasetItem> {
    const res = await http().put(`${itemsBase(orgId, datasetId)}/${itemId}`, {
      input: payload.input,
      expectedOutput: payload.expectedOutput,
      metadata: payload.metadata ?? null,
      tags: payload.tags ?? [],
    });
    return normalizeItem(res.data);
  },

  /** Soft delete — appends a tombstone, so the response is the tombstone row. */
  async removeItem(orgId: string, datasetId: string, itemId: string): Promise<void> {
    await http().delete(`${itemsBase(orgId, datasetId)}/${itemId}`);
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
