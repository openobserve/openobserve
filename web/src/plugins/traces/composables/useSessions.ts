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
import useHttpStreaming from "@/composables/useStreamingSearch";
import { generateTraceContext } from "@/utils/zincutils";
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
  status: "ok" | "error";
}

export interface SessionTraceRow {
  traceId: string;
  startTimeMicros: number;
  durationNanos: number;
  spanCount: number;
  inputTokens: number;
  outputTokens: number;
  tokens: number;
  cost: number;
  errorCount: number;
  status: "ok" | "error";
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
  // `fetchTurnDetail` still uses the raw SQL streaming search to grab
  // the messages of a single trace when its row is expanded — the
  // session-list endpoint and the trace `latest_stream` endpoint
  // don't expose final assistant text or per-span output.
  const { executeQuery, cancelAll } = useLLMStreamQuery();
  // The trace `latest_stream` endpoint (server-side aggregation per
  // trace, LLM-aware fields) drives the per-turn list inside a
  // session. Lifted out of `useLLMStreamQuery` because the URL +
  // payload shape differs (GET with query params, not a POST SQL).
  const { fetchQueryDataWithHttpStream, cancelStreamQueryBasedOnRequestId } =
    useHttpStreaming();
  const activeLatestStreamTraceIds = new Set<string>();

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
    // Escape single quotes so a malformed session id can't break the
    // server's filter-to-WHERE expansion.
    const safeId = sessionId.replace(/'/g, "''");
    const filter = `gen_ai_conversation_id='${safeId}'`;

    // Hit the existing per-stream traces endpoint instead of running
    // a one-off GROUP BY ourselves. Server-side it's the same shape
    // OpenObserve already uses for the Traces tab, and on LLM
    // streams it adds gen_ai_usage_* totals + the first chat span's
    // input messages — exactly what the session-detail page needs.
    const accumulated: any[] = await streamLatestTraces(
      streamName,
      filter,
      startTime,
      endTime,
    );

    if (accumulated.length === 0) {
      return { detail: null, traces: [] };
    }

    // Sort chronologically so the conversation list reads in turn
    // order. The endpoint returns DESC by default to surface "most
    // recent" first; for a session we want oldest-first.
    accumulated.sort(
      (a, b) => (Number(a.start_time) || 0) - (Number(b.start_time) || 0),
    );

    // Map each trace summary to SessionTraceRow.
    //
    // Field-name + unit notes from the live response:
    //   start_time / end_time → nanoseconds (UInt64 on the span)
    //   duration              → microseconds (server returns ns/1000)
    //   spans                 → [total_spans, error_spans] tuple
    //   service_name          → [{ service_name, count, duration }]
    //   gen_ai_usage_*        → cumulative across all spans
    //   gen_ai_input_messages → FIRST_VALUE — the user question
    //
    // `startTimeMicros` / `durationNanos` on the row type are
    // misnomers — both formatters in SessionDetails.vue divide by
    // 1_000_000 / 1_000 respectively, i.e. they expect nanoseconds.
    // We keep the unit convention (nanos) so the existing template
    // keeps formatting correctly without touching the UI layer.
    const traces: SessionTraceRow[] = accumulated.map((r: any) => {
      const spansArr = Array.isArray(r.spans) ? r.spans : [];
      const spanCount = Number(spansArr[0]) || 0;
      const errorCount = Number(spansArr[1]) || 0;
      const svcArr = Array.isArray(r.service_name) ? r.service_name : [];
      const model =
        r.gen_ai_response_model || r.gen_ai_request_model || null;
      const startNanos = Number(r.start_time) || 0;
      const endNanos = Number(r.end_time) || 0;
      return {
        traceId: String(r.trace_id ?? ""),
        startTimeMicros: startNanos,
        // Prefer the computed (end - start) so we stay in nanos —
        // the server's `duration` is already divided to micros and
        // would 1000× under-render through formatDuration.
        durationNanos: endNanos > startNanos ? endNanos - startNanos : 0,
        spanCount,
        inputTokens: Number(r.gen_ai_usage_input_tokens) || 0,
        outputTokens: Number(r.gen_ai_usage_output_tokens) || 0,
        tokens: Number(r.gen_ai_usage_total_tokens) || 0,
        cost: Number(r.gen_ai_usage_cost) || 0,
        errorCount,
        status: errorCount > 0 ? "error" : "ok",
        model: model ? String(model) : null,
        serviceName: svcArr[0]?.service_name
          ? String(svcArr[0].service_name)
          : null,
      } as SessionTraceRow & { serviceName: string | null };
    });

    // Roll the per-trace rows up into the session-level detail.
    let firstSeenNanos = Infinity;
    let lastSeenNanos = 0;
    let totalTokens = 0;
    let totalCost = 0;
    let totalErrors = 0;
    let serviceName: string | null = null;
    for (let i = 0; i < accumulated.length; i++) {
      const r = accumulated[i];
      const t = traces[i] as SessionTraceRow & { serviceName?: string | null };
      const sn = Number(r.start_time) || 0;
      const en = Number(r.end_time) || 0;
      if (sn && sn < firstSeenNanos) firstSeenNanos = sn;
      if (en > lastSeenNanos) lastSeenNanos = en;
      totalTokens += t.tokens;
      totalCost += t.cost;
      totalErrors += t.errorCount;
      if (!serviceName && t.serviceName) serviceName = t.serviceName;
    }
    if (firstSeenNanos === Infinity) firstSeenNanos = 0;

    const detail: SessionDetail = {
      sessionId,
      userId: null,
      serviceName,
      firstSeenMicros: firstSeenNanos,
      durationNanos:
        lastSeenNanos > firstSeenNanos ? lastSeenNanos - firstSeenNanos : 0,
      turns: traces.length,
      tokens: totalTokens,
      cost: totalCost,
      errorCount: totalErrors,
      status: totalErrors > 0 ? "error" : "ok",
    };

    return { detail, traces };
  }

  /**
   * Drive the `/api/{org}/{stream}/traces/latest_stream` HTTP/2
   * streaming GET via the shared streaming-search composable. Accumulates
   * hits across all SSE chunks and resolves once the server signals
   * `complete`. Tracks the trace_id so `cancelAll` can abort an
   * in-flight session-detail fetch on tab switch / unmount.
   */
  function streamLatestTraces(
    streamName: string,
    filter: string,
    startTime: number,
    endTime: number,
  ): Promise<any[]> {
    return new Promise((resolve, reject) => {
      const traceId = generateTraceContext().traceId;
      activeLatestStreamTraceIds.add(traceId);
      const hits: any[] = [];

      fetchQueryDataWithHttpStream(
        {
          queryReq: {
            stream_name: streamName,
            filter,
            start_time: startTime,
            end_time: endTime,
            from: 0,
            size: 1000,
          },
          type: "traces",
          traceId,
          org_id: store.state.selectedOrganization?.identifier,
        },
        {
          data: (_payload: any, response: any) => {
            const chunkHits: any[] = response.content?.results?.hits || [];
            if (chunkHits.length > 0) hits.push(...chunkHits);
          },
          error: (response: any) => {
            activeLatestStreamTraceIds.delete(traceId);
            const body = response?.content ?? response ?? {};
            const message =
              body.message ||
              body.error ||
              body.error_detail ||
              "Failed to fetch session traces";
            const err: any = new Error(message);
            err.status = body.status;
            err.raw = response;
            reject(err);
          },
          complete: () => {
            activeLatestStreamTraceIds.delete(traceId);
            resolve(hits);
          },
          reset: () => {},
        },
      );
    });
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

    // First pass — forward — pick model and the user question for THIS
    // turn. `gen_ai.input.messages` carries the FULL prompt sent to
    // the model (system + every prior turn + the current question),
    // so the *last* user-role entry of the *first* span is the
    // current turn's question, not turn 1's.
    for (const span of hits || []) {
      if (!model) {
        const m = getModel(span);
        if (m) model = m;
      }
      if (!userMessage) {
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
      if (userMessage && model) break;
    }

    // Second pass — reverse — pick the FINAL assistant reply for this
    // turn. An agent may make multiple LLM calls (LLM → tool → LLM
    // → tool → … → final answer). The first chat span's output is
    // usually an intermediate "I should call tool X" reply; the user
    // wants the answer at the end, not the planning step. Walking
    // from the latest span back gives us the final non-empty
    // assistant message.
    for (let s = (hits || []).length - 1; s >= 0; s--) {
      const span = hits[s];
      const outputMsgs = messagesFromOutput(span.gen_ai_output_messages);
      let a: any = null;
      for (let i = outputMsgs.length - 1; i >= 0; i--) {
        if (outputMsgs[i].role === "assistant" && outputMsgs[i].content) {
          a = outputMsgs[i];
          break;
        }
      }
      if (a) {
        assistantMessage = { role: "assistant", content: a.content };
        break;
      }
    }

    return { traceId, userMessage, assistantMessage, model };
  }

  /**
   * Cancel every in-flight stream this composable owns: SQL streams
   * from `useLLMStreamQuery` AND any `latest_stream` GET requests we
   * started for the session-detail page. Called from the parent on
   * unmount so server-side work isn't kept around after the tab goes
   * away.
   */
  function cancelAllSessionStreams() {
    cancelAll();
    activeLatestStreamTraceIds.forEach((id) => {
      cancelStreamQueryBasedOnRequestId({
        trace_id: id,
        org_id: store.state.selectedOrganization?.identifier,
      });
    });
    activeLatestStreamTraceIds.clear();
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
    cancelAll: cancelAllSessionStreams,
  };
}
