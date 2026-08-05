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

// ─── LLM Annotation · Discovery ─────────────────────────────────────────────
// Discovery is the stateless triage list: "find unhealthy traces/spans/sessions
// worth reviewing" → bulk Add-to-queue. Bound to:
//   GET  /api/{org}/discovery                        — list unhealthy items
//   POST /api/{org}/annotation_queues/{queueId}/items — enqueue one item
// The view consumes ONLY the normalized (flat, camelCase) row below.

export type DiscoveryScope = "span" | "trace" | "session";
export type DiscoveryQuality = "issue" | "multiple";
/** Queue-membership filter. Backend also supports pending/reviewed. */
export type DiscoveryQueueStatus = "not_enqueued" | "enqueued" | "all";

/** One unhealthy row (normalized from the `/discovery` response). */
export interface LlmDiscoveryItem {
  scope: DiscoveryScope;
  /** The reviewed object's id (span_id / trace_id / session_id per scope). */
  targetId: string;
  traceId: string | null;
  sessionId: string | null;
  /** Reference timestamp, MICROSECONDS. */
  refTimestamp: number;
  sourceStream: string | null;
  quality: DiscoveryQuality;
  issueCount: number;
  operationName: string;
  serviceName: string;
  agentName: string | null;
  model: string | null;
  /** Span duration, microseconds. */
  durationUs: number;
  // NOTE(BE gap): the `/discovery` response carries no business `input` text and
  // no per-row queue-membership flag. `input` stays empty until the backend
  // joins it; `inQueue` is optimistic (set locally when this session enqueues a
  // row) so Add-to-queue gives immediate feedback.
  input: string;
  inQueue: boolean;
}

export interface DiscoverySearchParams {
  scope: DiscoveryScope;
  /** Window bounds, MICROSECONDS. */
  startTime: number;
  endTime: number;
  from?: number;
  size?: number;
  queueStatus?: DiscoveryQueueStatus;
}

export interface DiscoverySearchResult {
  items: LlmDiscoveryItem[];
  total: number;
  from: number;
  size: number;
}

const base = (org: string) => `/api/${org}/discovery`;

// Optimistic membership: ids enqueued during this session. The `/discovery`
// response has no per-row inQueue flag, so this drives the "In Queue?" column
// for immediate feedback (rows drop off on refetch under the not_enqueued filter).
const enqueuedIds = new Set<string>();

/** Fold a `/discovery` row (nested `traceDetails`) into the flat shape. */
function normalize(d: any): LlmDiscoveryItem {
  const td = d.traceDetails ?? {};
  const targetId = d.targetId ?? td.span_id ?? td.trace_id ?? "";
  return {
    scope: (d.scope ?? "trace") as DiscoveryScope,
    targetId,
    traceId: d.traceId ?? td.trace_id ?? null,
    sessionId: d.sessionId ?? null,
    refTimestamp: d.refTimestamp ?? td._timestamp ?? 0,
    sourceStream: d.sourceStream ?? null,
    quality: (d.quality ?? "issue") as DiscoveryQuality,
    issueCount: d.issueCount ?? 1,
    operationName: td.operation_name ?? "",
    serviceName: td.service_name ?? "",
    agentName: td.gen_ai_agent_name ?? null,
    model: td.gen_ai_request_model ?? null,
    durationUs: td.duration ?? 0,
    input: d.input ?? "",
    inQueue: enqueuedIds.has(targetId),
  };
}

const llmDiscoveryService = {
  async search(orgId: string, params: DiscoverySearchParams): Promise<DiscoverySearchResult> {
    const res = await http().get(base(orgId), {
      params: {
        scope: params.scope,
        queue_status: params.queueStatus ?? "not_enqueued",
        start_time: params.startTime,
        end_time: params.endTime,
        from: params.from ?? 0,
        size: params.size ?? 50,
      },
    });
    const data = res.data ?? {};
    const list = Array.isArray(data.list) ? data.list : [];
    return {
      items: list.map(normalize),
      total: data.total ?? list.length,
      from: data.from ?? 0,
      size: data.size ?? list.length,
    };
  },

  /**
   * Add the given discovered objects to a review queue. The backend enqueues one
   * object per request, so we fan out; the reference (trace id + start time) is
   * required per item for the Workbench score/annotation window.
   */
  async addToQueue(
    orgId: string,
    queueId: string,
    items: Pick<LlmDiscoveryItem, "scope" | "targetId" | "traceId" | "refTimestamp">[],
  ): Promise<number> {
    const url = `/api/${orgId}/annotation_queues/${queueId}/items`;
    await Promise.all(
      items.map((it) =>
        http().post(url, {
          refType: it.scope,
          refId: it.targetId,
          refTraceId: it.traceId ?? undefined,
          refTraceStartTime: it.refTimestamp,
        }),
      ),
    );
    items.forEach((it) => enqueuedIds.add(it.targetId));
    return items.length;
  },
};

export default llmDiscoveryService;
