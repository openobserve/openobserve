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

/**
 * Pure helpers used by `ThreadView.vue` to project a flat list of OTEL
 * spans into a chat-style transcript. Extracted out of the SFC so they
 * can be unit-tested without mounting the component.
 *
 * No Vue imports. No DOM. No vuex. Just data-in / data-out.
 */

// ---------------------------------------------------------------------------
// Field resolvers — read OTEL gen_ai_* first, fall back to legacy llm_* so
// historical traces still render. Centralised so a future field rename is a
// one-file change.
// ---------------------------------------------------------------------------

/**
 * Read the LLM operation kind from a span. Normalised to upper-case.
 * @example getOp({ gen_ai_operation_name: "chat" })             // "CHAT"
 * @example getOp({ llm_observation_type: "GENERATION" })        // "GENERATION"
 * @example getOp({})                                            // ""
 */
export function getOp(span: any): string {
  return String(
    span?.gen_ai_operation_name || span?.llm_observation_type || "",
  ).toUpperCase();
}

/**
 * Read the model name. Prefers the response model (what actually served
 * the call) over the request model (what was asked for).
 * @example getModel({ gen_ai_response_model: "claude-sonnet-4-6" })
 *          // "claude-sonnet-4-6"
 */
export function getModel(span: any): string {
  return String(
    span?.gen_ai_response_model || span?.gen_ai_request_model || "",
  );
}

/**
 * Raw input messages payload (un-parsed). Format depends on the SDK —
 * could be a JSON string, an array, or an object. Use `messagesFromInput`
 * for a normalised list.
 */
export function getInputRaw(span: any): unknown {
  return span?.gen_ai_input_messages ?? span?.llm_input;
}

/**
 * Raw output messages payload (un-parsed). Same caveats as `getInputRaw`.
 */
export function getOutputRaw(span: any): unknown {
  return span?.gen_ai_output_messages ?? span?.llm_output;
}

/**
 * Read the call cost in USD. Falls back to legacy llm_usage_cost_total.
 * Returns 0 for missing / unparseable values (instead of NaN).
 */
export function getCost(span: any): number {
  return (
    Number(span?.gen_ai_usage_cost) ||
    Number(span?.llm_usage_cost_total) ||
    0
  );
}

/**
 * Read the total token count. Falls back to llm_usage_tokens_total.
 */
export function getTokens(span: any): number {
  return (
    Number(span?.gen_ai_usage_total_tokens) ||
    Number(span?.llm_usage_tokens_total) ||
    0
  );
}

// ---------------------------------------------------------------------------
// Span classification
// ---------------------------------------------------------------------------

export type SpanKind = "llm_turn" | "tool_call" | "agent" | "root" | "other";

/**
 * Does the span carry a non-empty input messages payload? Used as a
 * second check beyond the operation name to filter wrapper spans
 * (Vertex/ADK tag `generate_content` with `gen_ai.operation.name=GENERATION`
 * even though it carries no `messages` array — the actual model call
 * is the inner span).
 *
 * @example hasLLMPayload({ gen_ai_input_messages: '[{"role":"user"}]' }) // true
 * @example hasLLMPayload({ gen_ai_input_messages: '{}' })                // false
 * @example hasLLMPayload({})                                             // false
 */
export function hasLLMPayload(span: any): boolean {
  const inp = getInputRaw(span);
  if (typeof inp === "string") return inp.length > 2; // skip "{}" / "[]"
  if (inp && typeof inp === "object") return Object.keys(inp).length > 0;
  return false;
}

/**
 * Sort a span into one of the kinds the chat view cares about.
 *
 * Rules:
 *   - "GENERATION" + non-empty payload → llm_turn (renders as a chat step)
 *   - "TOOL"                           → tool_call (renders under its parent)
 *   - "AGENT"                          → agent (used for context, not rendered)
 *   - server span with no parent       → root (the trace root)
 *   - everything else                  → other
 *
 * @example classify({ gen_ai_operation_name: "GENERATION",
 *                     gen_ai_input_messages: "[{...}]" })     // "llm_turn"
 * @example classify({ gen_ai_operation_name: "TOOL" })        // "tool_call"
 * @example classify({ span_kind: "2" })                       // "root"
 */
export function classify(span: any): SpanKind {
  const obs = getOp(span);
  if (obs === "GENERATION" && hasLLMPayload(span)) return "llm_turn";
  if (obs === "TOOL") return "tool_call";
  if (obs === "AGENT") return "agent";
  if (
    String(span?.span_kind || "") === "2" &&
    !span?.reference_parent_span_id
  ) {
    return "root";
  }
  return "other";
}

// ---------------------------------------------------------------------------
// Message parsing
// ---------------------------------------------------------------------------

export type Role = "system" | "user" | "assistant" | "tool" | "unknown";

export interface Message {
  role: Role;
  content: string;
  /** stable signature used for dedup across turns */
  sig: string;
}

/**
 * Try to parse a value as JSON; return it untouched if it's already an
 * object/array, or `null` for non-strings / parse failures.
 *
 * @example safeParseJSON('{"a":1}')   // { a: 1 }
 * @example safeParseJSON({ a: 1 })    // { a: 1 } (passthrough)
 * @example safeParseJSON("not json")  // null
 * @example safeParseJSON(null)        // null
 */
export function safeParseJSON<T = any>(value: unknown): T | null {
  if (value == null) return null;
  if (typeof value !== "string") return value as T;
  const trimmed = value.trim();
  if (!trimmed) return null;
  try {
    return JSON.parse(trimmed) as T;
  } catch {
    return null;
  }
}

/**
 * Map raw role strings to the canonical 5-value union we render against.
 * Common SDK aliases: "human" → user, "model"/"ai" → assistant,
 * "function" → tool.
 */
export function normalizeRole(raw: unknown): Role {
  const r = String(raw ?? "").toLowerCase();
  if (r === "system") return "system";
  if (r === "user" || r === "human") return "user";
  if (r === "assistant" || r === "model" || r === "ai") return "assistant";
  if (r === "tool" || r === "function") return "tool";
  return "unknown";
}

/**
 * Pull the textual content out of an SDK-specific message body. Handles:
 *   - plain strings
 *   - OTEL/Anthropic multipart arrays of `{type:"text", text}` parts
 *   - Vertex/ADK `function_response.response.content` payloads
 *   - Vertex/ADK `parts` arrays
 *   - generic `{text}` / `{content}` objects
 *
 * Non-text parts (function_call objects, image blobs, etc.) are silently
 * dropped — those have first-class rendering elsewhere (tool spans),
 * and including them as raw stringified JSON would cover several screens
 * in a chat UI.
 *
 * @example extractContent("hello")                 // "hello"
 * @example extractContent([{ text: "a" },
 *                         { text: "b" }])          // "a\nb"
 * @example extractContent({ parts: [{ text: "x" }] }) // "x"
 */
export function extractContent(content: unknown): string {
  if (content == null) return "";
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((part: any) => {
        if (typeof part === "string") return part;
        if (part?.text) return String(part.text);
        if (part?.type === "text") return String(part.content ?? "");
        if (part?.function_response?.response?.content) {
          return extractContent(part.function_response.response.content);
        }
        return "";
      })
      .filter(Boolean)
      .join("\n");
  }
  if (typeof content === "object") {
    const obj = content as any;
    if (typeof obj.text === "string") return obj.text;
    if (typeof obj.content === "string") return obj.content;
    if (Array.isArray(obj.parts)) return extractContent(obj.parts);
    return "";
  }
  return String(content);
}

/**
 * Find the array of messages inside an SDK request envelope. Supports:
 *   1. Flat OTEL array       — [{role, content}, ...]
 *   2. Wrapped messages key  — {messages: [...]}
 *   3. Vertex/ADK request    — {model, config, contents: [...]}
 */
export function resolveMessageArray(parsed: any): any[] {
  if (!parsed) return [];
  if (Array.isArray(parsed)) return parsed;
  if (Array.isArray(parsed.messages)) return parsed.messages;
  if (Array.isArray(parsed.contents)) return parsed.contents;
  return [];
}

/**
 * Convert the raw input payload into a normalised `Message[]`.
 *
 * Vertex/ADK's `config.system_instruction` is surfaced as a synthetic
 * `role: "system"` message even though the SDK doesn't put it in the
 * messages array — without this, Vertex traces would have no system
 * prompt panel.
 */
export function messagesFromInput(raw: unknown): Message[] {
  const parsed = safeParseJSON(raw);
  if (!parsed) return [];

  const arr = resolveMessageArray(parsed);
  const messages: Message[] = [];
  const sysInstruction = (parsed as any)?.config?.system_instruction;
  if (typeof sysInstruction === "string" && sysInstruction.trim()) {
    messages.push({
      role: "system",
      content: sysInstruction,
      sig: `system::${sysInstruction}`,
    });
  }

  if (!arr.length) return messages;

  for (const m of arr) {
    const role = normalizeRole(m?.role);
    const content = extractContent(m?.content ?? m?.text ?? m?.parts);
    messages.push({ role, content, sig: `${role}::${content}` });
  }
  return messages;
}

/**
 * Convert the raw output payload into a normalised `Message[]`.
 *
 * Vertex/ADK responses have shape `{content: {role, parts}}` rather than
 * an array — promote the inner `content` into a single message.
 */
export function messagesFromOutput(raw: unknown): Message[] {
  const parsed = safeParseJSON(raw);
  if (!parsed) return [];

  if (
    !Array.isArray(parsed) &&
    (parsed as any).content &&
    typeof (parsed as any).content === "object"
  ) {
    const inner = (parsed as any).content;
    const role = normalizeRole(inner?.role || "assistant");
    const content = extractContent(inner?.parts ?? inner?.content ?? inner);
    if (!content) return [];
    return [{ role, content, sig: `${role}::${content}` }];
  }

  const arr = Array.isArray(parsed) ? parsed : [parsed];
  return arr
    .map((m: any) => {
      const role = normalizeRole(m?.role || "assistant");
      const content = extractContent(m?.content ?? m?.text ?? m?.parts);
      if (!content) return null;
      return { role, content, sig: `${role}::${content}` };
    })
    .filter(Boolean) as Message[];
}

/**
 * Heuristic — does this look like a framework-internal user-role message
 * (tool feedback, "for context:" prelude, agent-quoting-agent) rather
 * than a real human turn?
 *
 * Without this filter, agentic traces show a stream of fake user
 * messages that obscure the actual human ↔ assistant exchange.
 *
 * @example looksLikeAgentInjection("[tool_result: ...]")          // true
 * @example looksLikeAgentInjection("For context: prior turn ...") // true
 * @example looksLikeAgentInjection("[planner] said: ...")         // true
 * @example looksLikeAgentInjection("Hello, can you help me?")     // false
 */
export function looksLikeAgentInjection(text: string): boolean {
  if (!text) return false;
  const trimmed = text.trim();
  if (!trimmed) return false;

  const head = trimmed.slice(0, 400);

  if (
    /^\[\s*(tool[_ ]result|tool[_ ]call|tool schemas|tool[_ ]response|function[_ ]call|function[_ ]response)/i.test(
      head,
    )
  ) {
    return true;
  }

  if (/^for context\s*[:\-]/i.test(head)) return true;

  if (/^\[?[\w._-]+\]?\s+said[:\-]/i.test(head)) return true;

  return false;
}

// ---------------------------------------------------------------------------
// Turn / trace-group construction
// ---------------------------------------------------------------------------

export interface Turn {
  span: any;
  toolCalls: any[];
  /** Assistant text response(s) for this step. */
  assistant: Message[];
  /** New genuine user messages introduced before this step. */
  followupUsers: Message[];
}

export interface TraceGroup {
  traceId: string;
  rootStartTime: number;
  systemPrompt: string;
  userQuery: string;
  /** Resolved user identifier (email / id / name). Empty string if unknown. */
  userId: string;
  /** Number of historical user messages whose answers live in earlier traces. */
  historicalUserCount: number;
  turns: Turn[];
  totalCost: number;
  totalDurationNs: number;
  errorCount: number;
}

/**
 * Pure helper: turn a flat span list (from one trace_id) into a
 * `TraceGroup`. Returns `null` when the trace has no LLM-turn spans
 * (we don't render an empty chat for non-LLM traces).
 *
 * Logic:
 *   1. Sort LLM turns by start_time so the chat reads top-down.
 *   2. Attach tool spans to their parent turn by `reference_parent_span_id`.
 *      If no spans match (some SDKs flatten the parent chain), fall back
 *      to a time-window match: tools whose `start_time` is between this
 *      turn and the next.
 *   3. Resolve the trace's "system prompt" + "user query" from turn 0's
 *      input. Filter agent-injection look-alikes.
 *   4. For each subsequent turn, find genuine new user messages (dedup
 *      against the canonical user query and against earlier turns' new
 *      messages by `sig`).
 *   5. Aggregate per-trace cost / duration / error count.
 */
export function buildTraceGroup(spans: any[]): TraceGroup | null {
  if (!spans.length) return null;
  const traceId = String(spans[0].trace_id || "");

  const llmTurns = spans
    .filter((s) => classify(s) === "llm_turn")
    .sort((a, b) => Number(a.start_time) - Number(b.start_time));
  if (!llmTurns.length) return null;

  const toolSpans = spans.filter((s) => classify(s) === "tool_call");
  const byParent = new Map<string, any[]>();
  for (const t of toolSpans) {
    const pid = String(t.reference_parent_span_id || "");
    if (!byParent.has(pid)) byParent.set(pid, []);
    byParent.get(pid)!.push(t);
  }

  const inp0 = messagesFromInput(getInputRaw(llmTurns[0]));
  const sys = inp0.find((m) => m.role === "system");

  const rootSpan = spans.find(
    (s) => s.span_kind === "2" && !s.reference_parent_span_id,
  );
  const explicit = String(rootSpan?.user_query || "").trim();
  let derived = "";
  for (let j = inp0.length - 1; j >= 0; j--) {
    const m = inp0[j];
    if (m.role !== "user") continue;
    if (!m.content || looksLikeAgentInjection(m.content)) continue;
    derived = m.content;
    break;
  }
  const userQuery = explicit || derived;

  let historicalUserCount = 0;
  for (const m of inp0) {
    if (m.role !== "user") continue;
    if (!m.content || looksLikeAgentInjection(m.content)) continue;
    if (m.content === userQuery) continue;
    historicalUserCount++;
  }

  const seenRealUserSigs = new Set<string>();
  const turns: Turn[] = llmTurns.map((turnSpan, i) => {
    const turnId = String(turnSpan.span_id);

    let attached = byParent.get(turnId) || [];
    if (attached.length === 0) {
      const start = Number(turnSpan.start_time);
      const end =
        i + 1 < llmTurns.length
          ? Number(llmTurns[i + 1].start_time)
          : Number.POSITIVE_INFINITY;
      attached = toolSpans.filter((t) => {
        const ts = Number(t.start_time);
        return ts >= start && ts < end;
      });
    }

    const inputMessages = messagesFromInput(getInputRaw(turnSpan));
    const followupUsers: Message[] = [];
    for (const m of inputMessages) {
      if (m.role !== "user") continue;
      if (!m.content || looksLikeAgentInjection(m.content)) continue;
      if (m.content === userQuery) continue;
      if (seenRealUserSigs.has(m.sig)) continue;
      seenRealUserSigs.add(m.sig);
      if (i >= 1) followupUsers.push(m);
    }

    return {
      span: turnSpan,
      toolCalls: attached.sort(
        (a, b) => Number(a.start_time) - Number(b.start_time),
      ),
      assistant: messagesFromOutput(getOutputRaw(turnSpan)),
      followupUsers,
    };
  });

  const totalCost = turns.reduce((s, t) => s + getCost(t.span), 0);
  const startNs = Math.min(
    ...spans.map((s) => Number(s.start_time)).filter(Number.isFinite),
  );
  const endNs = Math.max(
    ...spans.map((s) => Number(s.end_time)).filter(Number.isFinite),
  );
  const totalDurationNs = isFinite(endNs - startNs) ? endNs - startNs : 0;
  const errorCount = spans.filter((s) => s.span_status === "ERROR").length;

  const userId = String(
    rootSpan?.user_email ||
      rootSpan?.user_id ||
      rootSpan?.gen_ai_user_id ||
      rootSpan?.["enduser.id"] ||
      rootSpan?.enduser_id ||
      rootSpan?.user_name ||
      "",
  ).trim();

  return {
    traceId,
    rootStartTime: Number(rootSpan?.start_time || llmTurns[0].start_time) || 0,
    systemPrompt: sys?.content || "",
    userQuery,
    userId,
    historicalUserCount,
    turns,
    totalCost,
    totalDurationNs,
    errorCount,
  };
}
