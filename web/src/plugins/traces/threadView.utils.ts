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

import { raw } from "@/types/i18n";
import type { TurnDetail, TurnMessage } from "./composables/useSessions";
import { extractGenAiPartText, isSuppressedGenAiPartType } from "./genAiParts";

// ---------------------------------------------------------------------------
// Field resolvers — read OTEL gen_ai_* attributes.
// ---------------------------------------------------------------------------

/**
 * Read the LLM operation kind from a span.
 * Uses the OTEL gen_ai.operation.name value directly.
 */
export function getOp(span: any): string {
  return String(span?.gen_ai_operation_name || "");
}

/**
 * Read the model name. Prefers the response model (what actually served
 * the call) over the request model (what was asked for).
 */
export function getModel(span: any): string {
  return String(span?.gen_ai_response_model || span?.gen_ai_request_model || "");
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
  return Number(span?.gen_ai_usage_cost) || Number(span?.llm_usage_cost_total) || 0;
}

/**
 * Read the total token count. Falls back to llm_usage_tokens_total.
 */
export function getTokens(span: any): number {
  return Number(span?.gen_ai_usage_total_tokens) || Number(span?.llm_usage_tokens_total) || 0;
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
 */
export function hasLLMPayload(span: any): boolean {
  const input = decodeAnyValue(getInputRaw(span));
  if (input == null) return false;
  if (typeof input === "string") return input.trim().length > 0;
  if (Array.isArray(input)) return input.length > 0;
  if (typeof input === "object") return Object.keys(input).length > 0;
  return true;
}

/**
 * Sort a span into one of the kinds the chat view cares about.
 *
 * Rules:
 *   - {chat, text_completion, generate_content} + non-empty payload → llm_turn
 *   - "execute_tool"                           → tool_call
 *   - {invoke_agent, create_agent}              → agent
 *   - server span with no parent                → root
 *   - everything else                           → other
 */
/**
 * Operation names that count as a model call for the per-turn call badges.
 * Deliberately broader than `classify`'s `llm_turn` set — an `embeddings`
 * span is a real LLM call even though it carries no chat transcript.
 */
export const LLM_CALL_OPS = new Set(["chat", "text_completion", "generate_content", "embeddings"]);

export function classify(span: any): SpanKind {
  const obs = getOp(span);
  const LLM_TURN_OPS = new Set(["chat", "text_completion", "generate_content"]);
  if (LLM_TURN_OPS.has(obs) && hasLLMPayload(span)) return "llm_turn";
  if (obs === "execute_tool") return "tool_call";
  const AGENT_OPS = new Set(["invoke_agent", "create_agent"]);
  if (AGENT_OPS.has(obs)) return "agent";
  if (String(span?.span_kind || "") === "2" && !span?.reference_parent_span_id) {
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

type UnknownRecord = Record<string, unknown>;

function isRecord(value: unknown): value is UnknownRecord {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/**
 * Try to parse a value as JSON; return it untouched if it's already an
 * object/array, or `null` for non-strings / parse failures.
 */
export function safeParseJSON<T = unknown>(value: unknown): T | null {
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
 * Decode JSON-encoded OTEL AnyValue payloads while preserving scalar strings.
 */
function decodeAnyValue(value: unknown): unknown {
  if (value == null) return null;
  if (typeof value !== "string") return value;

  const trimmed = value.trim();
  if (!trimmed) return null;
  try {
    return JSON.parse(trimmed) as unknown;
  } catch {
    return value;
  }
}

/** Map SDK role aliases (human, model, ai, function, developer) to the canonical union. */
export function normalizeRole(raw: unknown): Role {
  const r = String(raw ?? "").toLowerCase();
  if (r === "system" || r === "developer") return "system";
  if (r === "user" || r === "human") return "user";
  if (r === "assistant" || r === "model" || r === "ai") return "assistant";
  if (r === "tool" || r === "function") return "tool";
  return "unknown";
}

/** Text of an SDK-specific message body; keep part aliases in sync with genAiParts.ts. */
export function extractContent(content: unknown): string {
  if (content == null) return "";
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((part: unknown) => {
        if (typeof part === "string") return part;
        if (!isRecord(part)) return "";
        // OpenInference list content: `contents[].message_content.{type,text,image}`.
        if (isRecord(part.message_content)) return extractContent([part.message_content]);
        if (part.text) return String(part.text);
        // Tool calls render as cards (toolCallParts), not as bubble text.
        if (isToolCallRecord(part) || part.type === "server_tool_call") return "";
        // Anthropic extended thinking is the model's scratchpad, not its reply.
        if (part.type === "redacted_thinking") return "";
        if (part.type === "thinking" && typeof part.thinking === "string") return "";

        const genAiText = extractGenAiPartText(part);
        if (genAiText != null) return genAiText;

        const functionResponse = part.function_response;
        if (isRecord(functionResponse)) {
          const response = functionResponse.response;
          if (isRecord(response) && response.content) {
            return extractContent(response.content);
          }
        }

        const partType = typeof part.type === "string" ? part.type : "";
        if (partType && !isSuppressedGenAiPartType(partType)) return `[${partType}]`;
        return "";
      })
      .filter(Boolean)
      .join("\n");
  }
  if (isRecord(content)) {
    const obj = content;
    if (typeof obj.text === "string") return obj.text;
    if (typeof obj.content === "string") return obj.content;
    if (Array.isArray(obj.parts)) return extractContent(obj.parts);
    return "";
  }
  return String(content);
}

/** Find the messages array inside any supported SDK envelope. */
export function resolveMessageArray(parsed: unknown): unknown[] {
  if (!parsed) return [];
  if (Array.isArray(parsed)) return flattenBatches(parsed);
  if (!isRecord(parsed)) return [];
  if (Array.isArray(parsed.messages)) return flattenBatches(parsed.messages);
  if (Array.isArray(parsed.contents)) return parsed.contents;
  if (Array.isArray(parsed.candidates)) {
    return parsed.candidates.map((c) => (isRecord(c) && isRecord(c.content) ? c.content : c));
  }
  if (Array.isArray(parsed.generations)) return flattenBatches(parsed.generations);
  if (isRecord(parsed.output) && isRecord(parsed.output.message)) return [parsed.output.message];
  return [];
}

/** LangChain records one list per prompt of a batch: `[[m1, m2], …]` reads as `[m1, m2, …]`. */
function flattenBatches(arr: unknown[]): unknown[] {
  return arr.length > 0 && arr.every((item) => Array.isArray(item)) ? arr.flat() : arr;
}

function anyValueToText(value: unknown): string {
  const content = extractContent(value);
  if (content) return content;
  if (value == null) return "";
  if (typeof value !== "object") return String(value);
  if (Array.isArray(value) && value.length === 0) return "";
  if (isRecord(value) && Object.keys(value).length === 0) return "";

  try {
    return JSON.stringify(value) ?? "";
  } catch {
    return String(value);
  }
}

const MESSAGE_CONTENT_KEYS = ["content", "text", "parts", "contents", "blocks"];

/** Does the record carry its own message body (LlamaIndex writes `blocks`)? */
function hasMessageContent(record: UnknownRecord): boolean {
  return MESSAGE_CONTENT_KEYS.some((key) => key in record);
}

/** The message a record wraps (OpenInference, LangChain ChatGeneration, LlamaIndex ChatResponse). */
function wrappedMessage(value: unknown): UnknownRecord | null {
  return isRecord(value) && isRecord(value.message) && !("role" in value) ? value.message : null;
}

/** A LangChain serialized or `messages_to_dict` message as a plain `{role, content, tool_calls}` record. */
function fromLangChain(value: unknown): unknown {
  if (!isRecord(value)) return value;
  if (value.type === "constructor" && "lc" in value && isRecord(value.kwargs)) {
    const kwargs = value.kwargs;
    const className = Array.isArray(value.id) ? String(value.id[value.id.length - 1] ?? "") : "";
    return {
      ...kwargs,
      role: kwargs.role ?? kwargs.type ?? className.replace(/Message(Chunk)?$/, ""),
    };
  }
  if (isRecord(value.data) && !("role" in value) && normalizeRole(value.type) !== "unknown") {
    return { ...value.data, role: value.data.role ?? value.type };
  }
  return value;
}

/** A record wrapping a message but carrying its own text (ChatGeneration) reads as that text. */
function toMessage(value: unknown): unknown {
  const wrapped = wrappedMessage(value);
  return fromLangChain(wrapped && !hasMessageContent(value as UnknownRecord) ? wrapped : value);
}

/** Keys under which SDKs nest one tool call: OpenInference, Gemini, Vertex/ADK and Bedrock. */
const TOOL_CALL_WRAPPERS = ["tool_call", "functionCall", "function_call", "toolUse"];

function toolCallWrapper(value: UnknownRecord): UnknownRecord | null {
  for (const key of TOOL_CALL_WRAPPERS) {
    const call = value[key];
    if (isRecord(call)) return call;
  }
  return null;
}

/** True for a record that is itself one tool call, in any SDK shape `toolCallFrom` reads. */
function isToolCallRecord(value: UnknownRecord): boolean {
  return (
    value.type === "tool_call" ||
    value.type === "tool_use" ||
    value.type === "function_call" ||
    typeof value.toolName === "string" ||
    toolCallWrapper(value) !== null
  );
}

function messageFromAnyValue(value: unknown, defaultRole: Role): Message | null {
  const unwrapped = toMessage(value);
  const record = isRecord(unwrapped) ? unwrapped : null;
  // OpenAI Responses tool results and reasoning summaries are not chat messages.
  if (
    record &&
    (record.type === "function_call_output" ||
      (record.type === "reasoning" && Array.isArray(record.summary)))
  ) {
    return null;
  }
  const role = normalizeRole(record?.role ?? defaultRole);
  const hasContent = record !== null && hasMessageContent(record);
  // A tool call, or a message carrying only tool calls, is drawn as a tool card.
  if (record && !hasContent && (isToolCallRecord(record) || "tool_calls" in record)) {
    return null;
  }
  const rawContent = hasContent
    ? (record.content ?? record.text ?? record.parts ?? record.contents ?? record.blocks)
    : unwrapped;
  const content = hasContent ? extractContent(rawContent) : anyValueToText(rawContent);

  if (!content.trim()) return null;
  return { role, content, sig: `${role}::${content}` };
}

/** Out-of-array system prompts (Vertex, Gemini, Anthropic/Bedrock) become a system message. */
export function messagesFromInput(raw: unknown): Message[] {
  const parsed = decodeAnyValue(raw);
  if (parsed == null) return [];

  const arr = resolveMessageArray(parsed);
  const messages: Message[] = [];
  const config = isRecord(parsed) && isRecord(parsed.config) ? parsed.config : null;
  const envelope = isRecord(parsed) && !("role" in parsed) ? parsed : null;
  for (const source of [
    config?.system_instruction,
    envelope?.systemInstruction,
    envelope?.system,
  ]) {
    const systemContent = anyValueToText(source);
    if (systemContent.trim()) {
      messages.push({
        role: "system",
        content: systemContent,
        sig: `system::${systemContent}`,
      });
    }
  }

  if (arr.length) {
    for (const value of arr) {
      const message = messageFromAnyValue(value, "user");
      if (message) messages.push(message);
    }
    return messages;
  }

  if (isRecord(parsed) && ("messages" in parsed || "contents" in parsed)) return messages;
  if (config) return messages;

  const message = messageFromAnyValue(parsed, "user");
  if (message) messages.push(message);
  return messages;
}

/**
 * Convert the raw output payload into a normalised `Message[]`.
 *
 * Vertex/ADK responses have shape `{content: {role, parts}}` rather than
 * an array — promote the inner `content` into a single message.
 */
export function messagesFromOutput(raw: unknown): Message[] {
  const parsed = decodeAnyValue(raw);
  if (parsed == null) return [];

  if (isRecord(parsed) && isRecord(parsed.content) && !("role" in parsed)) {
    const message = messageFromAnyValue(parsed.content, "assistant");
    return message ? [message] : [];
  }

  const arr = resolveMessageArray(parsed);
  if (arr.length) {
    return arr
      .map((value) => messageFromAnyValue(value, "assistant"))
      .filter((message): message is Message => message !== null);
  }

  if (isRecord(parsed) && ("messages" in parsed || "contents" in parsed)) return [];

  const message = messageFromAnyValue(parsed, "assistant");
  return message ? [message] : [];
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

  if (/^for context\s*[:-]/i.test(head)) return true;

  if (/^\[?[\w._-]+\]?\s+said[:-]/i.test(head)) return true;

  return false;
}

// ---------------------------------------------------------------------------
// Turn / trace-group construction
// ---------------------------------------------------------------------------

export interface ToolCallPart {
  id: string;
  name: string;
  arguments: unknown;
}

/** One tool call from any SDK shape (OpenAI, Anthropic, Responses, Vercel, Gemini, Bedrock, flat). */
function toolCallFrom(value: UnknownRecord): ToolCallPart {
  const call = toolCallWrapper(value) ?? value;
  const fn = isRecord(call.function) ? call.function : null;
  return {
    // Responses `id` names the output item; `call_id` is what the tool span carries.
    id: String(call.call_id ?? call.id ?? call.toolCallId ?? call.toolUseId ?? ""),
    name: String(fn?.name ?? call.name ?? call.toolName ?? ""),
    arguments: fn ? fn.arguments : (call.arguments ?? call.args ?? call.input),
  };
}

/** The tool calls an LLM turn asked for, in order, one per id. */
export function toolCallParts(raw: unknown): ToolCallPart[] {
  const parsed = decodeAnyValue(raw);
  if (parsed == null) return [];
  const messages = resolveMessageArray(parsed);
  const out: ToolCallPart[] = [];
  const seenIds = new Set<string>();
  const add = (value: unknown) => {
    if (!isRecord(value)) return;
    const call = toolCallFrom(value);
    if (call.id) {
      if (seenIds.has(call.id)) return;
      seenIds.add(call.id);
    }
    out.push(call);
  };
  for (const value of messages.length ? messages : [parsed]) {
    // The calls sit on the wrapped message, also when the wrapper keeps its own text.
    const m = fromLangChain(wrappedMessage(value) ?? value);
    if (!isRecord(m)) continue;
    if (isToolCallRecord(m)) {
      add(m);
      continue;
    }
    const parts = Array.isArray(m.parts) ? m.parts : Array.isArray(m.content) ? m.content : [];
    for (const p of parts) {
      if (isRecord(p) && isToolCallRecord(p)) add(p);
    }
    for (const c of Array.isArray(m.tool_calls) ? m.tool_calls : []) add(c);
  }
  return out;
}

/** A turn's tool spans plus placeholders for tool_call parts no span carries, so SDKs without tool spans still show calls. */
function withUnmatchedToolCalls(turnSpan: any, spans: any[]): any[] {
  const ids = new Set(spans.map((t) => String(t.gen_ai_tool_call_id ?? "")).filter(Boolean));
  // Spans without call ids cannot be matched to parts: trust the spans.
  if (spans.length && !ids.size) return spans;
  const extra = toolCallParts(getOutputRaw(turnSpan))
    // A call without a name has nothing to show on a card.
    .filter((c) => c.name && !ids.has(c.id) && (c.id || !spans.length))
    .map((c, i) => ({
      // An id is unique within the turn (see toolCallParts); an index keys an id-less call.
      span_id: `tool-call:${turnSpan.span_id}:${c.id ? `id:${c.id}` : `#${i}`}`,
      gen_ai_tool_name: c.name,
      gen_ai_tool_call_id: c.id,
      gen_ai_tool_call_arguments: c.arguments,
      start_time: turnSpan.end_time,
      synthetic: true,
    }));
  return [...spans, ...extra];
}

/** Earliest start and latest end in ns, skipping missing or negative times; null without both. */
export function spanTimeBounds(
  spans: ReadonlyArray<{ start_time?: unknown; end_time?: unknown }>,
): { startNs: number; endNs: number } | null {
  let startNs = Infinity;
  let endNs = -Infinity;
  // A loop, not Math.min(...spans): spreading a large trace overflows the argument limit.
  for (const span of spans) {
    const start = Number(span.start_time);
    const end = Number(span.end_time);
    if (Number.isFinite(start) && start >= 0 && start < startNs) startNs = start;
    if (Number.isFinite(end) && end >= 0 && end > endNs) endNs = end;
  }
  return Number.isFinite(startNs) && Number.isFinite(endNs) ? { startNs, endNs } : null;
}

/** Math.max over any number of values; spreading a large array overflows the argument limit. */
export function maxOf(values: ReadonlyArray<number>, initial = -Infinity): number {
  let max = initial;
  for (const value of values) max = Math.max(max, value);
  return max;
}

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

/** Tools fall back to a time-window match when SDKs flatten the parent chain. */
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

  const rootSpan = spans.find((s) => s.span_kind === "2" && !s.reference_parent_span_id);
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

  // Orphan tool spans wrapping the first model call fall in no turn's window, so turn 0 takes them.
  const firstStart = Number(llmTurns[0].start_time);
  const turnIds = new Set(llmTurns.map((s) => String(s.span_id)));
  const leadingTools = toolSpans.filter(
    (t) =>
      Number(t.start_time) < firstStart && !turnIds.has(String(t.reference_parent_span_id || "")),
  );

  const seenRealUserSigs = new Set<string>();
  const turns: Turn[] = llmTurns.map((turnSpan, i) => {
    const turnId = String(turnSpan.span_id);

    let attached = byParent.get(turnId) || [];
    if (attached.length === 0) {
      const start = Number(turnSpan.start_time);
      const end =
        i + 1 < llmTurns.length ? Number(llmTurns[i + 1].start_time) : Number.POSITIVE_INFINITY;
      attached = toolSpans.filter((t) => {
        const ts = Number(t.start_time);
        return ts >= start && ts < end;
      });
    }
    if (i === 0) attached = [...leadingTools, ...attached];

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
      toolCalls: withUnmatchedToolCalls(turnSpan, attached).sort(
        (a, b) => Number(a.start_time) - Number(b.start_time),
      ),
      assistant: messagesFromOutput(getOutputRaw(turnSpan)),
      followupUsers,
    };
  });

  const totalCost = turns.reduce((s, t) => s + getCost(t.span), 0);
  const bounds = spanTimeBounds(spans);
  const totalDurationNs = bounds ? bounds.endNs - bounds.startNs : 0;
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

/**
 * Per-turn summary — the user question, the final assistant reply, the model
 * and the call counts — derived from one trace's `gen_ai` spans. Backs the
 * session-detail turn cards, and shares this module's parsers with
 * `buildTraceGroup` so a turn card and the transcript can't disagree.
 *
 * Tool-execution spans are excluded from message extraction: their
 * `gen_ai_input_messages` / `gen_ai_output_messages` hold the tool's arguments
 * and its raw JSON result, not chat messages, and `messagesFromOutput` will
 * happily stringify such a payload into an `assistant` message. This matters
 * because an agent's chat span typically *wraps* the tool calls it makes — so
 * the tool span is the newest span in the trace by `start_time`, and the
 * newest → oldest walk below would otherwise surface the raw tool JSON where
 * the assistant's answer belongs.
 *
 * Tool spans are filtered by exclusion rather than by an `LLM_CALL_OPS`
 * allow-list on purpose: an SDK that tags its model calls with a non-standard
 * operation name should still get its answer rendered.
 *
 * @param traceId trace the spans belong to
 * @param spans   that trace's `gen_ai` spans, in any order
 */
export function buildTurnDetail(traceId: string, spans: any[]): TurnDetail {
  const ordered = (spans || [])
    .slice()
    .sort((a, b) => (Number(a.start_time) || 0) - (Number(b.start_time) || 0));

  let llmCalls = 0;
  let toolCalls = 0;
  let otherCalls = 0;
  const otherOps = new Set<string>();
  for (const sp of ordered) {
    const op = getOp(sp).toLowerCase();
    if (LLM_CALL_OPS.has(op)) llmCalls += 1;
    else if (op === "execute_tool") toolCalls += 1;
    else {
      otherCalls += 1;
      if (op) otherOps.add(op);
    }
  }

  const chatSpans = ordered.filter((sp) => getOp(sp).toLowerCase() !== "execute_tool");

  // user question = last user-role entry of a span's prompt. The prompt carries
  // the full history (system + every prior turn + the current question), so the
  // LAST user entry is this turn's question, not turn 1's.
  // model = the first span that carries one.
  let userMessage: TurnMessage | null = null;
  let model: string | null = null;
  for (const sp of chatSpans) {
    if (!model) {
      const m = getModel(sp);
      if (m) model = m;
    }
    if (!userMessage) {
      const inputMsgs = messagesFromInput(sp.gen_ai_input_messages);
      for (let i = inputMsgs.length - 1; i >= 0; i--) {
        if (inputMsgs[i].role === "user" && inputMsgs[i].content) {
          userMessage = { role: "user", content: raw(inputMsgs[i].content) };
          break;
        }
      }
    }
    if (userMessage && model) break;
  }

  // assistant reply = final non-empty assistant message (walk newest → oldest).
  // An agent makes several model calls per turn (LLM → tool → LLM → … → answer);
  // the earlier outputs are planning steps, the last one is the answer.
  let assistantMessage: TurnMessage | null = null;
  for (let s = chatSpans.length - 1; s >= 0; s--) {
    const outputMsgs = messagesFromOutput(chatSpans[s].gen_ai_output_messages);
    for (let i = outputMsgs.length - 1; i >= 0; i--) {
      if (outputMsgs[i].role === "assistant" && outputMsgs[i].content) {
        assistantMessage = { role: "assistant", content: raw(outputMsgs[i].content) };
        break;
      }
    }
    if (assistantMessage) break;
  }

  return {
    traceId,
    userMessage,
    assistantMessage,
    model,
    llmCalls,
    toolCalls,
    otherCalls,
    otherOps: [...otherOps].sort(),
  };
}
