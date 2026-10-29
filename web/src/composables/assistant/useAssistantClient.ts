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

import assistantService, {
  type ConfirmBody,
  type ConfirmResponse,
  type FeedbackBody,
} from "@/services/assistant";
import { refreshSession as httpRefreshSession } from "@/services/http";
import incidentsService, { type Incident } from "@/services/incidents";
import store from "@/stores";
import type { ImageAttachment } from "@/ts/interfaces/chat";
import { getUUID, getUUIDv7 } from "@/utils/uuid";

import { ERROR_LEDGER, toAssistantError } from "./assistantErrors";
import type { AssistantError, AssistantSession, SendRequest, Sid } from "./assistantStore.types";
import type { AssistantFrame } from "./frames";
import { parseStream, type StreamEnd } from "./sseParser";

/** B-13 returns the trace id on admission; until then it comes from `complete`. */
const TRACE_HEADER = "x-o2-trace-id";

/** One prior message of a browser-only chat; the server has no memory of it (constraint 18). */
export interface WireMessage {
  role: "user" | "assistant";
  content: string;
}

/** A `SendRequest` plus the transcript a chat without server persistence still has to carry. */
export type ClientSendRequest = SendRequest & { transcript?: WireMessage[] };

/** Where a stream's frames go; `send` and `tail` call it until `onEnd`. */
export interface FrameSink {
  /** Called before the first frame, so admission is never reduced after a buffered frame. */
  onAdmitted(result: Extract<SendResult, { ok: true }>): void;
  /** `id` is the last SSE `id:` line: the seq the frame comes after, shared by every frame until the next one (WP-18). */
  onFrame(frame: AssistantFrame, id: string | null): void;
  /** An id-only message: every frame through seq `id` was sent, so the tail can resume from it (B-03). */
  onBoundary?(id: string): void;
  onKeepalive(): void;
  /** An unknown frame type, already cut to 32 characters for `ai_frame_unknown`. */
  onUnknown(type: string): void;
  onEnd(reason: StreamEnd): void;
}

/** Resolves on admission; `null` never escapes (S&S D2, BE D2). */
export type SendResult =
  | { ok: true; status: number; traceId: string | null }
  | { ok: false; error: AssistantError; body?: unknown; aborted?: boolean };

export type TailResult = SendResult;

/** The session fields `stop` needs. */
export type StopTarget = Pick<AssistantSession, "sid" | "origin" | "record"> & {
  turnId?: string | null;
};

/** `00` §5.1: the one client every assistant surface uses. */
export interface AssistantClient {
  send(req: ClientSendRequest, sink: FrameSink, signal: AbortSignal): Promise<SendResult>;
  tail(
    org: string,
    sid: Sid,
    turnId: string,
    fromSeq: number,
    sink: FrameSink,
    signal: AbortSignal,
  ): Promise<TailResult>;
  stop(org: string, session: StopTarget): Promise<void>;
  confirm(org: string, sid: Sid, body: ConfirmBody, timeoutMs?: number): Promise<ConfirmResponse>;
  feedback(org: string, sid: Sid, body: FeedbackBody): Promise<void>;
}

export interface AssistantClientOptions {
  fetchImpl?: typeof fetch;
  /** The non-destructive refresh of `services/http.ts`; injected by specs. */
  refreshSession?: () => Promise<"refreshed" | "expired">;
  services?: Pick<typeof assistantService, "cancelTurn" | "confirm" | "feedback">;
  /** API origin; the store's `API_ENDPOINT` by default. */
  baseUrl?: () => string;
}

/** An incident and the report of the run its analysis names, as an incident chat attaches them. */
export interface IncidentReportRead {
  incident: Pick<
    Incident,
    "id" | "title" | "severity" | "status" | "first_alert_at" | "last_alert_at" | "resolved_at"
  >;
  /** Null before any analysis finished, or when its run can't be read. */
  run: IncidentReportRun | null;
}

export interface IncidentReportRun {
  id: string;
  /** The run's number in the incident's history, the oldest being 1; null when unlisted. */
  number: number | null;
  startedAt: number;
  report: string;
}

/** The shared client; streams over `fetch`, everything else through `services/assistant.ts`. */
export function useAssistantClient(opts: AssistantClientOptions = {}): AssistantClient {
  const fetchImpl = opts.fetchImpl ?? ((input, init) => fetch(input, init));
  const refresh = opts.refreshSession ?? (() => httpRefreshSession());
  const services = opts.services ?? assistantService;
  const baseUrl = opts.baseUrl ?? (() => String(store.state.API_ENDPOINT ?? ""));

  // One refresh per request and the same turn id on the resend (constraint 16); never the logout path.
  const open = async (
    request: () => Promise<Response>,
    expiredCode: "session_expired" | "signed_out",
    turnId: string,
  ): Promise<Response | SendResult> => {
    let response = await request();
    if (response.status === 401 && (await refresh()) === "refreshed") response = await request();
    if (response.status !== 401) return response;
    const error = toAssistantError({ status: 401, body: await readJson(response) }, { turnId });
    return { ok: false, error: { ...error, code: expiredCode, ...ERROR_LEDGER[expiredCode] } };
  };

  const stream = async (
    request: () => Promise<Response>,
    sink: FrameSink,
    signal: AbortSignal,
    turnId: string,
    expiredCode: "session_expired" | "signed_out",
  ): Promise<SendResult> => {
    let opened: Response | SendResult;
    try {
      opened = await open(request, expiredCode, turnId);
    } catch (err) {
      return rejected(err, signal, turnId);
    }
    if (!(opened instanceof Response)) return opened;
    if (!opened.ok) {
      const body = await readJson(opened);
      const error = toAssistantError({ status: opened.status, body }, { turnId });
      return { ok: false, error, body };
    }
    const admitted = {
      ok: true as const,
      status: opened.status,
      traceId: opened.headers.get(TRACE_HEADER),
    };
    sink.onAdmitted(admitted);
    if (!opened.body) sink.onEnd("eof");
    else void parseStream(opened.body, handlersOf(sink), signal).then((end) => sink.onEnd(end));
    return admitted;
  };

  return {
    send(req, sink, signal) {
      const url = `${baseUrl()}/api/${enc(req.org)}/ai/chat_stream`;
      const body = JSON.stringify(wireBody(req));
      const request = () =>
        fetchImpl(url, {
          method: "POST",
          body,
          credentials: "include",
          headers: streamHeaders(req.sid, req.turnId, true),
          signal,
        });
      return stream(request, sink, signal, req.turnId, "session_expired");
    },
    tail(org, sid, turnId, fromSeq, sink, signal) {
      const url =
        `${baseUrl()}/api/${enc(org)}/ai/chats/${enc(sid)}/turns/${enc(turnId)}/stream` +
        `?from_seq=${fromSeq}`;
      const request = () =>
        fetchImpl(url, {
          method: "GET",
          credentials: "include",
          headers: { ...streamHeaders(sid, turnId, false), "Last-Event-ID": String(fromSeq) },
          signal,
        });
      // A 401 while a turn already runs means the user signed out elsewhere (`80` §1.3).
      return stream(request, sink, signal, turnId, "signed_out");
    },
    async stop(org, session) {
      await services.cancelTurn(org, session.sid, session.turnId ?? "");
    },
    confirm: (org, sid, body, timeoutMs) => services.confirm(org, sid, body, timeoutMs),
    feedback: (org, sid, body) => services.feedback(org, sid, body),
  };
}

/** Reads `incident.rca`'s report run, then that run's report; null when the incident has none yet. */
export async function readIncidentReport(
  org: string,
  incidentId: string,
): Promise<IncidentReportRead | null> {
  const incident = (await incidentsService.get(org, incidentId)).data;
  if (!incident?.id) return null;
  return {
    incident: {
      id: incident.id,
      title: incident.title,
      severity: incident.severity,
      status: incident.status,
      first_alert_at: incident.first_alert_at,
      last_alert_at: incident.last_alert_at,
      resolved_at: incident.resolved_at,
    },
    run: await readReportRun(org, incident).catch(() => null),
  };
}

async function readReportRun(org: string, incident: Incident): Promise<IncidentReportRun | null> {
  const reportRun = incident.rca?.report_run;
  if (!reportRun?.run_id) return null;
  const run = (await incidentsService.getRcaRun(org, incident.id, reportRun.run_id)).data;
  const report = typeof run?.report === "string" ? run.report : "";
  if (!report.trim()) return null;
  const history = Array.isArray(incident.rca?.history) ? incident.rca.history : [];
  const index = history.findIndex((item) => item.run_id === reportRun.run_id);
  return {
    id: reportRun.run_id,
    number: index < 0 ? null : history.length - index,
    startedAt: reportRun.started_at,
    report,
  };
}

function wireBody(req: ClientSendRequest): Record<string, unknown> {
  const images = req.message.images?.length ? toWireImages(req.message.images) : undefined;
  const current: WireMessage = { role: "user", content: req.message.text };
  return {
    // With persistence the server holds the history, so only the new message goes (P-20, HT-07 AC 2).
    messages: [...(req.transcript ?? []), current],
    ...(typeof req.knownSeq === "number" && { known_seq: req.knownSeq }),
    context: req.context,
    ...(images && { images }),
    ...(req.mode && { mode: req.mode }),
    ...(req.ephemeral && { ephemeral: true }),
    ...(req.attachments?.length && { attachments: req.attachments }),
    ...(req.replyToApproval && { reply_to_approval: req.replyToApproval }),
  };
}

function toWireImages(images: ImageAttachment[]) {
  return images.map((img) => ({ data: img.data, mime_type: img.mimeType, filename: img.filename }));
}

function streamHeaders(sid: Sid, turnId: string, json: boolean): Record<string, string> {
  return {
    ...(json && { "Content-Type": "application/json" }),
    traceparent: traceparent(),
    "x-o2-assistant-session-id": sid,
    "x-o2-assistant-turn-id": turnId,
  };
}

function traceparent(): string {
  return `00-${getUUIDv7(true)}-${getUUID().replace(/-/g, "").slice(0, 16)}-01`;
}

function handlersOf(sink: FrameSink) {
  return {
    frame: (frame: AssistantFrame, id: string | null) => sink.onFrame(frame, id),
    boundary: (id: string) => sink.onBoundary?.(id),
    keepalive: () => sink.onKeepalive(),
    unknown: (type: string) => sink.onUnknown(type),
  };
}

function rejected(err: unknown, signal: AbortSignal, turnId: string): SendResult {
  // Only our own abort is a Stop; an AbortError from anything else is a failed request.
  const aborted = signal.aborted;
  const error = toAssistantError(err instanceof TypeError ? err : new TypeError(String(err)), {
    turnId,
  });
  return { ok: false, error, ...(aborted && { aborted: true }) };
}

async function readJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

function enc(value: string): string {
  return encodeURIComponent(value);
}
