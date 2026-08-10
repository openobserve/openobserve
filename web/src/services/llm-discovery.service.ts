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
/** Queue-membership filter — the five values `queue_status` accepts. */
export type DiscoveryQueueStatus = "not_enqueued" | "enqueued" | "pending" | "reviewed" | "all";

export interface DiscoveryQueueMembership {
  queueId: string;
  queueName: string | null;
  status: "pending" | "reviewed";
}

/** One unhealthy row (normalized from the `/discovery` response).
 *
 *  The API hydrates a scope-shaped `context` object; the fields that don't apply
 *  to the active scope stay null, so the view reads one flat row per scope
 *  (span: kind/duration · trace: service · session: user/traces/duration/agent). */
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
  /** Business input, flattened to text (the raw field can be a JSON payload). */
  input: string;
  /** span + trace */
  operationName: string;
  /** span + trace, standardized GenAI operation (for example `chat`) */
  genAiOperationName: string;
  /** span + trace */
  spanKind: string | null;
  /** trace only */
  serviceName: string;
  /** span + session, microseconds */
  durationUs: number | null;
  /** session only */
  userEmail: string | null;
  /** session only */
  traceCount: number | null;
  /** session only, from `context.agentParameters` */
  agentName: string | null;
  queues: DiscoveryQueueMembership[];
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

/** Unhealthy counts for all three scopes, returned on every response. */
export interface DiscoveryScopeTotals {
  span: number;
  trace: number;
  session: number;
}

export interface DiscoverySearchResult {
  items: LlmDiscoveryItem[];
  total: number;
  scopeTotals: DiscoveryScopeTotals;
  from: number;
  size: number;
  hasMore: boolean;
}

/** The API's page-size ceiling (`size` is validated to 1..100 server-side). */
export const DISCOVERY_MAX_PAGE_SIZE = 100;

const base = (org: string) => `/api/${org}/discovery`;

/** `context.input` is whatever the trace stream held — a plain string for simple
 *  prompts, a JSON messages payload otherwise. The list needs one line of text. */
function inputText(value: unknown): string {
  if (value == null) return "";
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value);
  } catch {
    return "";
  }
}

function numberOrNull(value: unknown): number | null {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function stringOrNull(value: unknown): string | null {
  return typeof value === "string" && value.length ? value : null;
}

/** Fold a `/discovery` row into the flat shape. Display fields live under a
 *  scope-shaped `context` object hydrated from the target trace stream; a row
 *  whose context couldn't be hydrated still renders (ids + quality only). */
function normalize(d: any): LlmDiscoveryItem {
  const ctx = d.context ?? {};
  const agent = ctx.agentParameters ?? {};
  const queues: DiscoveryQueueMembership[] = Array.isArray(d.queues)
    ? d.queues
        .filter(
          (queue: any) =>
            typeof queue?.queueId === "string" &&
            (queue.status === "pending" || queue.status === "reviewed"),
        )
        .map((queue: any) => ({
          queueId: queue.queueId,
          queueName: stringOrNull(queue.queueName),
          status: queue.status,
        }))
    : [];
  return {
    scope: (d.scope ?? "trace") as DiscoveryScope,
    targetId: d.targetId ?? "",
    traceId: stringOrNull(d.traceId),
    sessionId: stringOrNull(d.sessionId) ?? stringOrNull(ctx.sessionId),
    refTimestamp: numberOrNull(d.refTimestamp) ?? 0,
    sourceStream: stringOrNull(d.sourceStream),
    quality: (d.quality ?? "issue") as DiscoveryQuality,
    issueCount: numberOrNull(d.issueCount) ?? 1,
    input: inputText(ctx.input),
    operationName: stringOrNull(ctx.operationName) ?? "",
    genAiOperationName: stringOrNull(ctx.genAiOperationName) ?? "",
    spanKind: stringOrNull(ctx.spanKind),
    serviceName: stringOrNull(ctx.serviceName) ?? "",
    durationUs: numberOrNull(ctx.duration),
    userEmail: stringOrNull(ctx.userEmail),
    traceCount: numberOrNull(ctx.traceCount),
    agentName: stringOrNull(agent.name),
    queues,
    inQueue: queues.length > 0,
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
        size: Math.min(params.size ?? 20, DISCOVERY_MAX_PAGE_SIZE),
      },
    });
    const data = res.data ?? {};
    const list = Array.isArray(data.list) ? data.list : [];
    const totals = data.scopeTotals ?? {};
    return {
      items: list.map(normalize),
      total: numberOrNull(data.total) ?? list.length,
      scopeTotals: {
        span: numberOrNull(totals.span) ?? 0,
        trace: numberOrNull(totals.trace) ?? 0,
        session: numberOrNull(totals.session) ?? 0,
      },
      from: numberOrNull(data.from) ?? 0,
      size: numberOrNull(data.size) ?? list.length,
      hasMore: data.hasMore === true,
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
    return items.length;
  },
};

export default llmDiscoveryService;
