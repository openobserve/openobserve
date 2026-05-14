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

import { ref } from "vue";
import { useStore } from "vuex";
import sessionsService from "@/services/sessions";
import { useLLMStreamQuery } from "./useLLMStreamQuery";

export interface SessionDetail {
  sessionId: string;
  userId: string | null;
  serviceName: string | null;
  firstSeenMicros: number;
  durationNanos: number;
  turns: number;
  tokens: number;
  cost: number;
  errorCount: number;
  warnCount: number;
  status: "ok" | "warn" | "error";
}

export interface SessionTraceRow {
  traceId: string;
  startTimeMicros: number;
  durationNanos: number;
  spanCount: number;
  /** Sum of LLM call spans (gen_ai.operation.name is set). */
  llmCallCount: number;
  /** Sum of tool spans (tool_name is set OR operation_name = 'execute_tool'). */
  toolCallCount: number;
  inputTokens: number;
  outputTokens: number;
  tokens: number;
  cost: number;
  errorCount: number;
  status: "ok" | "warn" | "error";
  model: string | null;
}

/** Single message inside a turn (USER block / ASSISTANT block). */
export interface TurnMessage {
  role: "user" | "assistant" | "system" | "tool";
  content: string;
}

/** Full per-turn payload, lazy-loaded when a turn row is expanded. */
export interface TurnDetail {
  traceId: string;
  /** First user-role message in the turn — drives the USER block. */
  userMessage: TurnMessage | null;
  /** Last assistant-role message in the turn — drives the ASSISTANT block. */
  assistantMessage: TurnMessage | null;
  model: string | null;
}

/**
 * One row in the sessions list. Mirrors the
 * `GET /api/{org}/{stream}/traces/session` response shape, normalised
 * to the camelCase + unit-suffixed convention used elsewhere here.
 *
 * Backend returns timestamps + duration in NANOSECONDS — we keep the
 * nanos values on the row and the UI formats from there. (Same shape
 * span data uses elsewhere in OO.)
 */
export interface SessionRow {
  sessionId: string;
  /** Earliest span start_time in the session (nanoseconds). */
  firstSeenNanos: number;
  /** Latest span end_time in the session (nanoseconds). */
  lastSeenNanos: number;
  /** Number of distinct trace_ids in the session = conversation turns. */
  turns: number;
  /** Session duration in nanoseconds (end_time - start_time). */
  durationNanos: number;
  inputTokens: number;
  outputTokens: number;
  tokens: number;
  cost: number;
  errorCount: number;
  /** Derived from error_count: any error span → "error", else "ok". */
  status: "ok" | "error";
}

/**
 * Composable owning the Sessions tab's list state and fetch flow.
 *
 * One session = one value of `gen_ai_conversation_id`. Each session
 * may span many traces (turns) and many spans. We aggregate at the
 * session level on the server (GROUP BY gen_ai_conversation_id) and
 * the dashboard renders one row per session.
 *
 * State is per-mount, mirroring `useLLMInsights`.
 *
 * @example
 *   const { sessions, total, loading, error, fetchPage, cancelAll }
 *     = useSessions();
 *   await fetchPage("llm-stream", 1700000000000000, 1700001000000000, 0, 25);
 */
export function useSessions() {
  const store = useStore();
  // useLLMStreamQuery is still used by `fetchSession` / `fetchTurnDetail`
  // for the detail page, which needs richer per-trace SQL than the
  // sessions endpoint exposes.
  const { executeQuery, cancelAll } = useLLMStreamQuery();

  const sessions = ref<SessionRow[]>([]);
  const total = ref(0);
  const loading = ref(false);
  const error = ref<string | null>(null);
  const hasLoadedOnce = ref(false);

  /**
   * Fetch one page of sessions from the backend's dedicated sessions
   * endpoint (`GET /api/{org}/{stream}/traces/session`). The endpoint
   * runs the GROUP BY + per-trace gen_ai usage rollup server-side, so
   * the frontend doesn't construct any SQL.
   *
   * `page` is zero-indexed.
   *
   * Note: the response does not include user_id / service_name /
   * span_status, so derived fields like "status pill" or "user
   * avatar" are not available in the list view. Detail page still
   * uses `fetchSession` (SQL path) for those.
   */
  async function fetchPage(
    streamName: string,
    startTime: number,
    endTime: number,
    page: number,
    pageSize: number,
  ): Promise<void> {
    if (!streamName || !startTime || !endTime) return;
    loading.value = true;
    error.value = null;

    try {
      const orgId = store.state.selectedOrganization?.identifier || "default";
      const res = await sessionsService.list({
        orgId,
        streamName,
        startTime,
        endTime,
        page,
        pageSize,
      });
      const body = res.data;
      sessions.value = (body.hits || []).map((h) => {
        const errorCount = Number(h.error_count) || 0;
        return {
          sessionId: h.session_id,
          firstSeenNanos: Number(h.start_time) || 0,
          lastSeenNanos: Number(h.end_time) || 0,
          durationNanos: Number(h.duration) || 0,
          turns: Number(h.trace_count) || 0,
          inputTokens: Number(h.gen_ai_usage_input_tokens) || 0,
          outputTokens: Number(h.gen_ai_usage_output_tokens) || 0,
          tokens: Number(h.gen_ai_usage_total_tokens) || 0,
          cost: Number(h.gen_ai_usage_cost) || 0,
          errorCount,
          status: errorCount > 0 ? "error" : "ok",
        };
      });
      total.value = Number(body.total) || 0;
      hasLoadedOnce.value = true;
    } catch (e: any) {
      // axios error shape — surface the server's message if present.
      const serverMsg =
        e?.response?.data?.message ||
        e?.response?.data?.error ||
        e?.message ||
        "Failed to fetch sessions";
      error.value = serverMsg;
      console.error("Sessions fetch error:", e?.response?.data ?? e);
    } finally {
      loading.value = false;
    }
  }

  /**
   * Fetch the per-turn trace list for a single session and derive the
   * session-level rollup client-side.
   *
   * Single SQL call (GROUP BY trace_id). The session header KPIs —
   * turns, duration, tokens, cost, error count — are reductions over
   * the trace list, so issuing a second GROUP BY session_id query
   * would just duplicate work the server already did. `user_id` and
   * `service_name` are picked up per-trace and consolidated to the
   * first non-null value (they're effectively constant within a
   * session).
   */
  async function fetchSession(
    streamName: string,
    sessionId: string,
    startTime: number,
    endTime: number,
  ): Promise<{ detail: SessionDetail | null; traces: SessionTraceRow[] }> {
    if (!streamName || !sessionId || !startTime || !endTime) {
      return { detail: null, traces: [] };
    }
    // Escape single quotes so a malformed session id can't break the SQL.
    const safeId = sessionId.replace(/'/g, "''");

    const tracesSql = `
      SELECT
        trace_id                                                                 AS trace_id,
        MIN(start_time)                                                          AS start_time,
        MAX(end_time)                                                            AS end_time,
        MAX(end_time) - MIN(start_time)                                          AS duration_ns,
        COUNT(*)                                                                 AS span_count,
        COUNT(*) FILTER (WHERE gen_ai_operation_name IS NOT NULL)                AS llm_call_count,
        COUNT(*) FILTER (WHERE gen_ai_operation_name = 'execute_tool')           AS tool_call_count,
        COALESCE(SUM(gen_ai_usage_input_tokens), 0)                              AS input_tokens,
        COALESCE(SUM(gen_ai_usage_output_tokens), 0)                             AS output_tokens,
        COALESCE(SUM(gen_ai_usage_total_tokens), 0)                              AS tokens,
        COALESCE(SUM(gen_ai_usage_cost), 0)                                      AS cost,
        COUNT(*) FILTER (WHERE span_status = 'ERROR')                            AS error_count,
        COUNT(*) FILTER (WHERE span_status = 'WARN' OR span_status = 'WARNING')  AS warn_count,
        MAX(gen_ai_response_model)                                               AS model,
        MAX(user_id)                                                             AS user_id,
        MAX(service_name)                                                        AS service_name
      FROM "${streamName}"
      WHERE gen_ai_conversation_id = '${safeId}'
      GROUP BY trace_id
      ORDER BY start_time ASC
      LIMIT 1000
    `;

    const traceHits = await executeQuery(tracesSql, startTime, endTime);

    // Map per-trace rows first; we'll need to walk them once for the
    // session-level rollup anyway.
    const traces: SessionTraceRow[] = (traceHits || []).map((r: any) => {
      const ec = Number(r.error_count) || 0;
      const wc = Number(r.warn_count) || 0;
      return {
        traceId: String(r.trace_id ?? ""),
        startTimeMicros: Number(r.start_time) || 0,
        durationNanos: Number(r.duration_ns) || 0,
        spanCount: Number(r.span_count) || 0,
        llmCallCount: Number(r.llm_call_count) || 0,
        toolCallCount: Number(r.tool_call_count) || 0,
        inputTokens: Number(r.input_tokens) || 0,
        outputTokens: Number(r.output_tokens) || 0,
        tokens: Number(r.tokens) || 0,
        cost: Number(r.cost) || 0,
        errorCount: ec,
        status: ec > 0 ? "error" : wc > 0 ? "warn" : "ok",
        model: r.model ? String(r.model) : null,
      };
    });

    if (traces.length === 0) {
      return { detail: null, traces: [] };
    }

    // Roll the per-trace rows up into the session-level detail. user_id
    // / service_name are constant within a session, so first non-null
    // wins — saves emitting a second GROUP BY session_id query that
    // would produce the same numbers.
    let firstSeenMicros = Infinity;
    let lastSeenMicros = 0;
    let totalTokens = 0;
    let totalCost = 0;
    let totalErrors = 0;
    let totalWarns = 0;
    let userId: string | null = null;
    let serviceName: string | null = null;
    for (let i = 0; i < (traceHits || []).length; i++) {
      const r = traceHits[i];
      const t = traces[i];
      if (t.startTimeMicros && t.startTimeMicros < firstSeenMicros) {
        firstSeenMicros = t.startTimeMicros;
      }
      const traceEnd = Number(r.end_time) || 0;
      if (traceEnd > lastSeenMicros) lastSeenMicros = traceEnd;
      totalTokens += t.tokens;
      totalCost += t.cost;
      totalErrors += t.errorCount;
      // The trace row's `warn_count` isn't carried on SessionTraceRow,
      // so read it directly off the raw row.
      totalWarns += Number(r.warn_count) || 0;
      if (!userId && r.user_id) userId = String(r.user_id);
      if (!serviceName && r.service_name)
        serviceName = String(r.service_name);
    }
    if (firstSeenMicros === Infinity) firstSeenMicros = 0;

    const detail: SessionDetail = {
      sessionId,
      userId,
      serviceName,
      firstSeenMicros,
      // SessionDetail's duration field is named `durationNanos` for
      // historical reasons but the wire data is microseconds — we
      // convert at the formatter level (same as SessionsList).
      durationNanos:
        lastSeenMicros > firstSeenMicros
          ? lastSeenMicros - firstSeenMicros
          : 0,
      turns: traces.length,
      tokens: totalTokens,
      cost: totalCost,
      errorCount: totalErrors,
      warnCount: totalWarns,
      status:
        totalErrors > 0 ? "error" : totalWarns > 0 ? "warn" : "ok",
    };

    return { detail, traces };
  }

  /**
   * Fetch the message payload for a single turn (one trace). Used by
   * the SessionDetails accordion when a turn row is expanded.
   *
   * Pulls only the LLM-turn spans for that trace (the ones carrying
   * `gen_ai.input.messages` / `gen_ai.output.messages`), then picks
   * the first user message and last assistant message from the
   * normalised list — same convention used by `ThreadView`.
   */
  async function fetchTurnDetail(
    streamName: string,
    traceId: string,
    startTime: number,
    endTime: number,
  ): Promise<TurnDetail> {
    if (!streamName || !traceId || !startTime || !endTime) {
      return { traceId, userMessage: null, assistantMessage: null, model: null };
    }
    const safeId = traceId.replace(/'/g, "''");

    // Pull only the spans likely to carry messages. Sort by start_time
    // so the first hit is the earliest turn.
    const sql = `
      SELECT
        gen_ai_input_messages,
        gen_ai_output_messages,
        gen_ai_response_model,
        gen_ai_request_model,
        gen_ai_operation_name,
        start_time
      FROM "${streamName}"
      WHERE trace_id = '${safeId}'
        AND gen_ai_operation_name IS NOT NULL
        AND gen_ai_input_messages IS NOT NULL
      ORDER BY start_time ASC
      LIMIT 50
    `;

    const hits = await executeQuery(sql, startTime, endTime);
    // Lazy-import the message parser so this composable stays light
    // when only the list view is in use.
    const { messagesFromInput, messagesFromOutput, getModel } = await import(
      "../threadView.utils"
    );

    let userMessage: TurnMessage | null = null;
    let assistantMessage: TurnMessage | null = null;
    let model: string | null = null;

    for (const span of hits || []) {
      if (!model) {
        const m = getModel(span);
        if (m) model = m;
      }
      if (!userMessage) {
        // `gen_ai.input.messages` carries the FULL prompt sent to the
        // model — system + every prior turn + the current question. The
        // first user-role entry is therefore turn 1's question, not the
        // current turn's. Walk from the end to grab the actual question
        // for *this* turn.
        const inputMsgs = messagesFromInput(span.gen_ai_input_messages);
        let u: any = null;
        for (let i = inputMsgs.length - 1; i >= 0; i--) {
          if (inputMsgs[i].role === "user" && inputMsgs[i].content) {
            u = inputMsgs[i];
            break;
          }
        }
        if (u) userMessage = { role: "user", content: u.content };
      }
      if (!assistantMessage) {
        // Output payloads typically carry just the model's reply for
        // this turn, but defensively prefer the last assistant entry
        // (Vertex / ADK responses occasionally bundle a system echo).
        const outputMsgs = messagesFromOutput(span.gen_ai_output_messages);
        let a: any = null;
        for (let i = outputMsgs.length - 1; i >= 0; i--) {
          if (outputMsgs[i].role === "assistant" && outputMsgs[i].content) {
            a = outputMsgs[i];
            break;
          }
        }
        if (a) assistantMessage = { role: "assistant", content: a.content };
      }
      if (userMessage && assistantMessage && model) break;
    }

    return { traceId, userMessage, assistantMessage, model };
  }

  return {
    sessions,
    total,
    loading,
    error,
    hasLoadedOnce,
    fetchPage,
    fetchSession,
    fetchTurnDetail,
    cancelAll,
  };
}
