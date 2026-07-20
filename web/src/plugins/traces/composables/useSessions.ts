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
import { type GenAiAgentListItem } from "@/services/gen-ai-agent-mapping.service";
import { useLLMStreamQuery } from "./useLLMStreamQuery";
import { compactSql } from "../config/llmInsightsPanels";

export interface SessionDetail {
  sessionId: string;
  userId: string | null;
  serviceName: string | null;
  firstSeenMicros: number;
  durationNanos: number;
  turns: number;
  inputTokens: number;
  outputTokens: number;
  tokens: number;
  cost: number;
  cacheReadInputTokens: number;
  cacheCreationInputTokens: number;
  cacheReadInputCost: number;
  cacheCreationInputCost: number;
  estimatedCostWithoutCache: number;
  cacheReadSavings: number;
  netCacheImpact: number;
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
  cacheReadInputTokens: number;
  cacheCreationInputTokens: number;
  cacheReadInputCost: number;
  cacheCreationInputCost: number;
  estimatedCostWithoutCache: number;
  cacheReadSavings: number;
  netCacheImpact: number;
  errorCount: number;
  status: "ok" | "error";
  /** Primary model (first entry in the trace's models array). */
  model: string | null;
  /** All models used across spans in this trace. */
  models: string[];
  /**
   * Current turn's user question — the last user-role entry in this trace's
   * `gen_ai_input_messages` (the full prompt carries history; the last user
   * message is this turn's ask). Drives the turn-preview hover card. Empty
   * string when no user message is present.
   */
  turnUserMessage: string;
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
  /** Number of LLM call spans (chat / text_completion / generate_content / embeddings). */
  llmCalls: number;
  /** Number of tool execution spans (execute_tool). */
  toolCalls: number;
  /** gen_ai spans with an unrecognised operation name — neither LLM nor execute_tool. */
  otherCalls: number;
  /** Distinct operation names that make up otherCalls — used in the tooltip. */
  otherOps: string[];
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
  cacheReadInputTokens: number;
  cacheCreationInputTokens: number;
  cacheReadInputCost: number;
  cacheCreationInputCost: number;
  estimatedCostWithoutCache: number;
  cacheReadSavings: number;
  netCacheImpact: number;
  errorCount: number;
  /** Derived from error_count: any error span → "error", else "ok". */
  status: "ok" | "error";
  /** First user from the session's users array (may be empty string). */
  userId: string;
  /** First user message in the session (truncated server-side). */
  firstUserMessage: string;
}

// ---------------------------------------------------------------------------
// Module-scoped list state — a singleton that outlives the SessionsList
// component. Because it isn't re-created on each mount, navigating into a
// session detail and back restores the previously fetched page instead of
// re-hitting the API. Fresh data comes only from an explicit refresh or a date
// change.
// ---------------------------------------------------------------------------
const sessions = ref<SessionRow[]>([]);
const total = ref(0);
const loading = ref(false);
const error = ref<string | null>(null);
const hasLoadedOnce = ref(false);
// When the current page was last fetched (drives the header's "last refreshed"
// label) and the org it was fetched for (so switching org re-fetches rather
// than showing the previous org's sessions).
const lastRunAt = ref<number | null>(null);
const loadedOrg = ref<string | null>(null);
// Shared pagination so the page/size the user was on is preserved across the
// unmount/remount cycle and stays in sync with the restored rows.
const currentPage = ref(1);
const rowsPerPage = ref(20);
// Agent-filter list is loaded lazily by `loadSessions` (agent mode only), so it
// lives here too — otherwise a back-navigation, which skips that load, would
// reset `agentsLoaded` to false and strand the agent picker on its skeleton.
const agents = ref<GenAiAgentListItem[]>([]);
const agentsLoaded = ref(false);

/**
 * Composable owning the Sessions tab's list state and fetch flow.
 *
 * One session = one value of `gen_ai_conversation_id`. Each session
 * may span many traces (turns) and many spans. We aggregate at the
 * session level on the server (GROUP BY gen_ai_conversation_id) and
 * the dashboard renders one row per session.
 *
 * List state is a module-scoped singleton so it survives the SessionsList
 * component's unmount/remount cycle (e.g. drilling into a session detail and
 * navigating back) — the list only re-fetches on an explicit refresh or a date
 * change, not on every remount.
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
  // session-list and session-detail endpoints
  // don't expose final assistant text or per-span output.
  const { executeQuery, cancelAll } = useLLMStreamQuery();

  /**
   * Fetch one page of sessions from the backend's dedicated sessions
   * endpoint (`GET /api/{org}/{stream}/traces/session`). The endpoint
   * runs the GROUP BY + per-trace gen_ai usage rollup server-side, so
   * the frontend doesn't construct any SQL.
   *
   * `page` is zero-indexed.
   *
   * Note: the response does not include service_name/span_status details for
   * each turn. The detail page uses `fetchSession` for per-turn rows.
   */
  async function fetchPage(
    streamName: string,
    startTime: number,
    endTime: number,
    page: number,
    pageSize: number,
    filter = "",
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
        filter,
      });
      const body = res.data;
      sessions.value = (body.hits || []).map((h) => {
        const errorCount = Number(h.error_count) || 0;
        const usersArr: string[] = Array.isArray(h.user_ids) ? h.user_ids : [];
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
          cacheReadInputTokens: Number(h.gen_ai_usage_cache_read_input_tokens) || 0,
          cacheCreationInputTokens: Number(h.gen_ai_usage_cache_creation_input_tokens) || 0,
          cacheReadInputCost: Number(h.gen_ai_usage_cost_cache_read_input) || 0,
          cacheCreationInputCost: Number(h.gen_ai_usage_cost_cache_creation_input) || 0,
          estimatedCostWithoutCache: Number(h.gen_ai_usage_cost_estimated_without_cache) || 0,
          cacheReadSavings: Number(h.gen_ai_usage_cost_cache_read_savings) || 0,
          netCacheImpact: Number(h.gen_ai_usage_cost_net_cache_impact) || 0,
          errorCount,
          status: errorCount > 0 ? "error" : "ok",
          userId: usersArr[0] || "",
          firstUserMessage: String(h.first_user_message || ""),
        };
      });
      total.value = Number(body.total) || 0;
      hasLoadedOnce.value = true;
      // Stamp when/which-org this page was fetched — used to keep the "last
      // refreshed" label accurate and to invalidate the cache on org switch.
      lastRunAt.value = Date.now();
      loadedOrg.value = orgId;
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
   * The backend returns the same trace-summary hit shape that this mapper
   * already consumes, but with per-turn status computed from all spans in each
   * trace.
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
    const orgId = store.state.selectedOrganization?.identifier || "default";
    const res = await sessionsService.details({
      orgId,
      streamName,
      sessionId,
      startTime,
      endTime,
      from: 0,
      size: 1000,
    });
    const accumulated: any[] = res.data?.hits || [];

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
    //
    // Parse the per-trace user question from `gen_ai_input_messages` (already
    // in the response) so the turn-preview hover card has a message preview
    // without a second fetch. Lazy-import keeps the list-only path light.
    const { messagesFromInput } = await import("../threadView.utils");
    const userMessageOf = (raw: any): string => {
      const msgs = messagesFromInput(raw);
      for (let i = msgs.length - 1; i >= 0; i--) {
        if (msgs[i].role === "user" && msgs[i].content) return msgs[i].content;
      }
      return "";
    };
    const traces: SessionTraceRow[] = accumulated.map((r: any) => {
      const spansArr = Array.isArray(r.spans) ? r.spans : [];
      const spanCount = Number(spansArr[0]) || 0;
      const errorCount = Number(spansArr[1]) || 0;
      const svcArr = Array.isArray(r.service_name) ? r.service_name : [];
      const modelsArr: string[] = Array.isArray(r.models)
        ? r.models.map(String).filter(Boolean)
        : [];
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
        cacheReadInputTokens: Number(r.gen_ai_usage_cache_read_input_tokens) || 0,
        cacheCreationInputTokens: Number(r.gen_ai_usage_cache_creation_input_tokens) || 0,
        cacheReadInputCost: Number(r.gen_ai_usage_cost_cache_read_input) || 0,
        cacheCreationInputCost: Number(r.gen_ai_usage_cost_cache_creation_input) || 0,
        estimatedCostWithoutCache: Number(r.gen_ai_usage_cost_estimated_without_cache) || 0,
        cacheReadSavings: Number(r.gen_ai_usage_cost_cache_read_savings) || 0,
        netCacheImpact: Number(r.gen_ai_usage_cost_net_cache_impact) || 0,
        errorCount,
        status: errorCount > 0 ? "error" : "ok",
        model: modelsArr[0] ?? null,
        models: modelsArr,
        turnUserMessage: userMessageOf(r.gen_ai_input_messages),
        serviceName: svcArr[0]?.service_name
          ? String(svcArr[0].service_name)
          : null,
      } as SessionTraceRow & { serviceName: string | null };
    });

    // Roll the per-trace rows up into the session-level detail.
    let firstSeenNanos = Infinity;
    let lastSeenNanos = 0;
    let totalInputTokens = 0;
    let totalOutputTokens = 0;
    let totalTokens = 0;
    let totalCost = 0;
    let totalCacheReadInputTokens = 0;
    let totalCacheCreationInputTokens = 0;
    let totalCacheReadInputCost = 0;
    let totalCacheCreationInputCost = 0;
    let totalEstimatedCostWithoutCache = 0;
    let totalCacheReadSavings = 0;
    let totalNetCacheImpact = 0;
    let totalErrors = 0;
    let serviceName: string | null = null;
    for (let i = 0; i < accumulated.length; i++) {
      const r = accumulated[i];
      const t = traces[i] as SessionTraceRow & { serviceName?: string | null };
      const sn = Number(r.start_time) || 0;
      const en = Number(r.end_time) || 0;
      if (sn && sn < firstSeenNanos) firstSeenNanos = sn;
      if (en > lastSeenNanos) lastSeenNanos = en;
      totalInputTokens += t.inputTokens;
      totalOutputTokens += t.outputTokens;
      totalTokens += t.tokens;
      totalCost += t.cost;
      totalCacheReadInputTokens += t.cacheReadInputTokens;
      totalCacheCreationInputTokens += t.cacheCreationInputTokens;
      totalCacheReadInputCost += t.cacheReadInputCost;
      totalCacheCreationInputCost += t.cacheCreationInputCost;
      totalEstimatedCostWithoutCache += t.estimatedCostWithoutCache;
      totalCacheReadSavings += t.cacheReadSavings;
      totalNetCacheImpact += t.netCacheImpact;
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
      inputTokens: totalInputTokens,
      outputTokens: totalOutputTokens,
      tokens: totalTokens,
      cost: totalCost,
      cacheReadInputTokens: totalCacheReadInputTokens,
      cacheCreationInputTokens: totalCacheCreationInputTokens,
      cacheReadInputCost: totalCacheReadInputCost,
      cacheCreationInputCost: totalCacheCreationInputCost,
      estimatedCostWithoutCache: totalEstimatedCostWithoutCache,
      cacheReadSavings: totalCacheReadSavings,
      netCacheImpact: totalNetCacheImpact,
      errorCount: totalErrors,
      status: totalErrors > 0 ? "error" : "ok",
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
      return { traceId, userMessage: null, assistantMessage: null, model: null, llmCalls: 0, toolCalls: 0, otherCalls: 0, otherOps: [] };
    }
    const safeId = traceId.replace(/'/g, "''");

    // Fetch all gen_ai spans for this trace in one query. The
    // gen_ai_input_messages IS NOT NULL filter was previously applied here
    // but that meant a second parallel COUNT query was needed for LLM/tool
    // call badge counts. Removing the filter lets us compute the counts
    // client-side from the same result set, halving the number of API calls.
    const sql = compactSql(`
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
      ORDER BY start_time ASC
      LIMIT 50
    `);

    const LLM_OPS = new Set(["chat", "text_completion", "generate_content", "embeddings"]);

    const hits = await executeQuery(sql, startTime, endTime);

    let llmCalls = 0;
    let toolCalls = 0;
    let otherCalls = 0;
    const otherOpsSet = new Set<string>();
    for (const row of hits || []) {
      const op = String(row.gen_ai_operation_name || "").toLowerCase();
      if (LLM_OPS.has(op)) llmCalls += 1;
      else if (op === "execute_tool") toolCalls += 1;
      else { otherCalls += 1; otherOpsSet.add(op); }
    }
    const otherOps = [...otherOpsSet].sort();
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

    return { traceId, userMessage, assistantMessage, model, llmCalls, toolCalls, otherCalls, otherOps };
  }

  /**
   * Fetch all gen_ai spans across a session's traces — the raw span rows the
   * `ThreadView` component renders from (it groups by `trace_id` and classifies
   * by `gen_ai_operation_name`). Used by the session-detail "Pretty" transcript
   * view. Filters by the session's trace ids (rather than conversation_id) so
   * tool-execution spans are included, and selects exactly the columns
   * `ThreadView` reads.
   */
  async function fetchSessionSpans(
    streamName: string,
    traceIds: string[],
    startTime: number,
    endTime: number,
  ): Promise<any[]> {
    if (!streamName || !traceIds.length || !startTime || !endTime) return [];
    const inList = traceIds
      .map((id) => `'${String(id).replace(/'/g, "''")}'`)
      .join(",");
    const sql = compactSql(`
      SELECT
        span_id, trace_id, operation_name, gen_ai_operation_name,
        tool_name, gen_ai_tool_name, tool_args,
        duration, start_time, end_time,
        span_status, status_message,
        gen_ai_request_model, gen_ai_response_model,
        gen_ai_usage_cost, gen_ai_usage_total_tokens,
        gen_ai_input_messages, gen_ai_output_messages
      FROM "${streamName}"
      WHERE trace_id IN (${inList})
        AND gen_ai_operation_name IS NOT NULL
      ORDER BY start_time ASC
      LIMIT 2000
    `);
    return (await executeQuery(sql, startTime, endTime)) || [];
  }

  /**
   * Cancel in-flight SQL streams from `useLLMStreamQuery`. Called from the
   * parent on unmount so server-side turn-detail work isn't kept around after
   * the tab goes away.
   */
  function cancelAllSessionStreams() {
    cancelAll();
  }

  return {
    sessions,
    total,
    loading,
    error,
    hasLoadedOnce,
    lastRunAt,
    loadedOrg,
    currentPage,
    rowsPerPage,
    agents,
    agentsLoaded,
    fetchPage,
    fetchSession,
    fetchTurnDetail,
    fetchSessionSpans,
    cancelAll: cancelAllSessionStreams,
  };
}
