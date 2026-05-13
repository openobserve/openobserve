// Copyright 2026 OpenObserve Inc.
//
// Tests for the pure helpers backing ThreadView's chat projection.
// These functions are extracted from the SFC so they can be tested
// without mounting the full component — the goal is to nail down the
// many SDK-specific shapes (OTEL flat / Vertex `contents` / Anthropic
// multipart / agentic injection text) so a future SDK rev doesn't
// silently break the chat view.

import { describe, it, expect } from "vitest";
import {
  getOp,
  getModel,
  getInputRaw,
  getOutputRaw,
  getCost,
  getTokens,
  hasLLMPayload,
  classify,
  safeParseJSON,
  normalizeRole,
  extractContent,
  resolveMessageArray,
  messagesFromInput,
  messagesFromOutput,
  looksLikeAgentInjection,
  buildTraceGroup,
} from "./threadView.utils";

// ===========================================================================
// Field resolvers
// ===========================================================================

describe("getOp", () => {
  // Reads the gen_ai_operation_name directly — spec values are already lowercase.
  it("returns gen_ai_operation_name as-is (spec values are lowercase)", () => {
    expect(getOp({ gen_ai_operation_name: "chat" })).toBe("chat");
  });

  // Does NOT fall back to legacy llm_observation_type.
  it("does not fall back to legacy llm_observation_type", () => {
    expect(getOp({ llm_observation_type: "GENERATION" })).toBe("");
  });

  // Empty / missing fields → empty string (not undefined / NaN).
  it("returns empty string for spans without gen_ai_operation_name", () => {
    expect(getOp({})).toBe("");
    expect(getOp(null)).toBe("");
    expect(getOp(undefined)).toBe("");
  });
});

describe("getModel", () => {
  // gen_ai_response_model wins — that's the model that actually served
  // the call (could differ from request_model for routed/canary setups).
  it("prefers gen_ai_response_model over gen_ai_request_model", () => {
    expect(
      getModel({
        gen_ai_response_model: "claude-sonnet-4-6",
        gen_ai_request_model: "claude-3-opus",
      }),
    ).toBe("claude-sonnet-4-6");
  });

  it("falls back to gen_ai_request_model when response model is absent", () => {
    expect(getModel({ gen_ai_request_model: "gpt-4" })).toBe("gpt-4");
  });

  it("returns empty string when neither field is set", () => {
    expect(getModel({})).toBe("");
  });
});

describe("getInputRaw / getOutputRaw", () => {
  // gen_ai field wins over legacy.
  it("prefers gen_ai_input_messages and gen_ai_output_messages", () => {
    expect(
      getInputRaw({ gen_ai_input_messages: "[{...}]", llm_input: "ignored" }),
    ).toBe("[{...}]");
    expect(
      getOutputRaw({ gen_ai_output_messages: "[]", llm_output: "ignored" }),
    ).toBe("[]");
  });

  // Falls back to legacy.
  it("falls back to llm_input / llm_output", () => {
    expect(getInputRaw({ llm_input: "[{...}]" })).toBe("[{...}]");
    expect(getOutputRaw({ llm_output: "[{...}]" })).toBe("[{...}]");
  });

  // Both missing → undefined (not "" — distinguishes "no field" from
  // "empty string field" for callers like hasLLMPayload).
  it("returns undefined when neither field is set", () => {
    expect(getInputRaw({})).toBeUndefined();
    expect(getOutputRaw({})).toBeUndefined();
  });
});

describe("getCost / getTokens", () => {
  // Both helpers coerce via Number() and OR with 0, so missing/garbage
  // inputs come back as 0 (no NaN bleed).
  it("reads numeric values from gen_ai_* fields", () => {
    expect(getCost({ gen_ai_usage_cost: 0.123 })).toBe(0.123);
    expect(getTokens({ gen_ai_usage_total_tokens: 1234 })).toBe(1234);
  });

  it("falls back to llm_usage_cost_total / llm_usage_tokens_total", () => {
    expect(getCost({ llm_usage_cost_total: 0.5 })).toBe(0.5);
    expect(getTokens({ llm_usage_tokens_total: 200 })).toBe(200);
  });

  // String numbers are coerced — backend may return them as strings.
  it("coerces string numbers", () => {
    expect(getCost({ gen_ai_usage_cost: "1.5" })).toBe(1.5);
    expect(getTokens({ gen_ai_usage_total_tokens: "42" })).toBe(42);
  });

  // Missing field → 0; non-numeric → 0 (never NaN).
  it("returns 0 for missing or non-numeric values", () => {
    expect(getCost({})).toBe(0);
    expect(getTokens({})).toBe(0);
    expect(getCost({ gen_ai_usage_cost: "abc" })).toBe(0);
    expect(getTokens({ gen_ai_usage_total_tokens: null })).toBe(0);
  });
});

// ===========================================================================
// hasLLMPayload + classify
// ===========================================================================

describe("hasLLMPayload", () => {
  // String payloads need to be more than just "{}" or "[]" to count —
  // the trim length > 2 check catches empty stringified objects/arrays.
  it("returns true for a non-empty JSON-string input", () => {
    expect(
      hasLLMPayload({
        gen_ai_input_messages: '[{"role":"user","content":"hi"}]',
      }),
    ).toBe(true);
  });

  it('returns false for "[]" or "{}" (length ≤ 2 string)', () => {
    expect(hasLLMPayload({ gen_ai_input_messages: "[]" })).toBe(false);
    expect(hasLLMPayload({ gen_ai_input_messages: "{}" })).toBe(false);
  });

  // Object payloads — checks for any keys present.
  it("returns true for an object with at least one key", () => {
    expect(hasLLMPayload({ gen_ai_input_messages: { messages: [] } })).toBe(
      true,
    );
  });

  it("returns false for an empty object", () => {
    expect(hasLLMPayload({ gen_ai_input_messages: {} })).toBe(false);
  });

  // Missing or null input → no payload.
  it("returns false when input is missing or null", () => {
    expect(hasLLMPayload({})).toBe(false);
    expect(hasLLMPayload({ gen_ai_input_messages: null })).toBe(false);
  });
});

describe("classify", () => {
  // Real LLM call: chat + non-empty payload.
  it('classifies a span with "chat" op and payload as "llm_turn"', () => {
    expect(
      classify({
        gen_ai_operation_name: "chat",
        gen_ai_input_messages: '[{"role":"user","content":"x"}]',
      }),
    ).toBe("llm_turn");
  });

  // Vertex/ADK wrapper span: chat but no payload — should NOT
  // be classified as llm_turn (otherwise step counts double).
  it('classifies chat without payload as "other" (Vertex wrapper guard)', () => {
    expect(
      classify({ gen_ai_operation_name: "chat" }),
    ).toBe("other");
    expect(
      classify({
        gen_ai_operation_name: "chat",
        gen_ai_input_messages: "{}",
      }),
    ).toBe("other");
  });

  it('classifies an execute_tool span as "tool_call"', () => {
    expect(classify({ gen_ai_operation_name: "execute_tool" })).toBe("tool_call");
  });

  it('classifies an invoke_agent span as "agent"', () => {
    expect(classify({ gen_ai_operation_name: "invoke_agent" })).toBe("agent");
  });

  // Server span (kind=2) with no parent → root of the trace.
  it('classifies parentless server spans as "root"', () => {
    expect(classify({ span_kind: "2" })).toBe("root");
  });

  // Server span WITH a parent isn't the root.
  it("does NOT classify server span with parent as root", () => {
    expect(
      classify({ span_kind: "2", reference_parent_span_id: "abc" }),
    ).toBe("other");
  });

  // Anything else → other.
  it('classifies HTTP / random spans as "other"', () => {
    expect(classify({ operation_name: "GET /api" })).toBe("other");
  });
});

// ===========================================================================
// safeParseJSON
// ===========================================================================

describe("safeParseJSON", () => {
  it("parses a valid JSON string", () => {
    expect(safeParseJSON('{"a":1}')).toEqual({ a: 1 });
  });

  // Already-parsed objects pass through (be permissive — backend may
  // hand us either shape).
  it("passes objects/arrays through unchanged", () => {
    const obj = { a: 1 };
    expect(safeParseJSON(obj)).toBe(obj);
    const arr = [1, 2];
    expect(safeParseJSON(arr)).toBe(arr);
  });

  it("returns null for null / undefined / empty string", () => {
    expect(safeParseJSON(null)).toBeNull();
    expect(safeParseJSON(undefined)).toBeNull();
    expect(safeParseJSON("")).toBeNull();
    expect(safeParseJSON("   ")).toBeNull();
  });

  it("returns null for malformed JSON (instead of throwing)", () => {
    expect(safeParseJSON("not json")).toBeNull();
    expect(safeParseJSON("{ unterminated")).toBeNull();
  });

  // Whitespace-padded JSON still parses.
  it("trims whitespace before parsing", () => {
    expect(safeParseJSON("  {} ")).toEqual({});
  });
});

// ===========================================================================
// normalizeRole
// ===========================================================================

describe("normalizeRole", () => {
  // Canonical roles — the values render templates branch on.
  it.each([
    ["system", "system"],
    ["user", "user"],
    ["assistant", "assistant"],
    ["tool", "tool"],
  ])('keeps "%s" as "%s"', (input, expected) => {
    expect(normalizeRole(input)).toBe(expected);
  });

  // Common SDK aliases that should map to the canonical set.
  it.each([
    ["human", "user"],          // Anthropic SDK
    ["model", "assistant"],     // Vertex / older Gemini
    ["ai", "assistant"],        // LangChain
    ["function", "tool"],       // OpenAI function-calling era
  ])('maps alias "%s" to "%s"', (input, expected) => {
    expect(normalizeRole(input)).toBe(expected);
  });

  // Case-insensitive — SDKs are inconsistent about case.
  it("is case-insensitive", () => {
    expect(normalizeRole("USER")).toBe("user");
    expect(normalizeRole("Assistant")).toBe("assistant");
  });

  // Unknown / null → "unknown" (renders without role label).
  it('returns "unknown" for unknown / null / undefined', () => {
    expect(normalizeRole("evangelist")).toBe("unknown");
    expect(normalizeRole(null)).toBe("unknown");
    expect(normalizeRole(undefined)).toBe("unknown");
    expect(normalizeRole(42)).toBe("unknown");
  });
});

// ===========================================================================
// extractContent
// ===========================================================================

describe("extractContent", () => {
  // Plain string passes through.
  it("returns plain strings as-is", () => {
    expect(extractContent("hello")).toBe("hello");
  });

  // null/undefined → "" (so callers can safely assign without null-checks).
  it("returns empty string for null / undefined", () => {
    expect(extractContent(null)).toBe("");
    expect(extractContent(undefined)).toBe("");
  });

  // OTEL/Anthropic multipart array of {text} parts.
  it("joins {text} parts with newlines", () => {
    expect(extractContent([{ text: "a" }, { text: "b" }])).toBe("a\nb");
  });

  // Older SDK form: {type:"text", content:"..."}
  it("handles legacy {type:text, content} parts", () => {
    expect(
      extractContent([{ type: "text", content: "x" }]),
    ).toBe("x");
  });

  // Plain string elements inside an array (some SDKs do this).
  it("includes plain string array elements", () => {
    expect(extractContent(["a", "b"])).toBe("a\nb");
  });

  // Vertex/ADK shape: {parts: [{text}]} on the message envelope.
  it("recurses into Vertex/ADK parts arrays", () => {
    expect(
      extractContent({ parts: [{ text: "hi" }, { text: "there" }] }),
    ).toBe("hi\nthere");
  });

  // Vertex/ADK function_response.response.content payload — surface only
  // the textual body, not the wrapper metadata.
  it("recurses into Vertex function_response.response.content", () => {
    expect(
      extractContent([
        {
          function_response: {
            response: { content: [{ text: "result text" }] },
          },
        },
      ]),
    ).toBe("result text");
  });

  // Object with text/content prop directly.
  it("reads text or content prop from a plain object", () => {
    expect(extractContent({ text: "hi" })).toBe("hi");
    expect(extractContent({ content: "yo" })).toBe("yo");
  });

  // Non-text parts (function_call, image, etc.) are dropped — they have
  // first-class rendering elsewhere as tool spans.
  it("drops non-text parts (function_call, image)", () => {
    const result = extractContent([
      { text: "before" },
      { function_call: { name: "f", args: {} } },
      { text: "after" },
    ]);
    expect(result).toBe("before\nafter");
  });

  // Number / boolean → string conversion (rare but safe).
  it("stringifies primitives that aren't strings", () => {
    expect(extractContent(42 as any)).toBe("42");
    expect(extractContent(true as any)).toBe("true");
  });

  // Unknown object shape → empty string (don't dump JSON into the chat).
  it("returns empty string for unrecognised object shapes", () => {
    expect(extractContent({ random: "field" })).toBe("");
  });
});

// ===========================================================================
// resolveMessageArray
// ===========================================================================

describe("resolveMessageArray", () => {
  // Shape 1: bare array (OTEL flat format).
  it("returns the array if input is already an array", () => {
    const arr = [{ role: "user" }];
    expect(resolveMessageArray(arr)).toBe(arr);
  });

  // Shape 2: OpenAI-style { messages: [...] }
  it("returns parsed.messages when present", () => {
    const inner = [{ role: "user" }];
    expect(resolveMessageArray({ messages: inner })).toBe(inner);
  });

  // Shape 3: Vertex/ADK { contents: [...] }
  it("returns parsed.contents when present", () => {
    const inner = [{ role: "user", parts: [] }];
    expect(resolveMessageArray({ contents: inner })).toBe(inner);
  });

  // Empty/null/unknown shapes → []
  it("returns [] for null / unknown shapes", () => {
    expect(resolveMessageArray(null)).toEqual([]);
    expect(resolveMessageArray({ random: "field" })).toEqual([]);
  });
});

// ===========================================================================
// messagesFromInput
// ===========================================================================

describe("messagesFromInput", () => {
  // Flat OTEL array — the simplest case.
  it("parses a flat OTEL message array", () => {
    const json = JSON.stringify([
      { role: "user", content: "hello" },
      { role: "assistant", content: "hi" },
    ]);
    const msgs = messagesFromInput(json);
    expect(msgs.length).toBe(2);
    expect(msgs[0]).toMatchObject({ role: "user", content: "hello" });
    expect(msgs[1]).toMatchObject({ role: "assistant", content: "hi" });
    // sig used for cross-turn dedup.
    expect(msgs[0].sig).toBe("user::hello");
  });

  // OpenAI-style { messages: [...] }
  it("parses an OpenAI-style { messages: [...] } envelope", () => {
    const json = JSON.stringify({
      messages: [{ role: "user", content: "yo" }],
    });
    const msgs = messagesFromInput(json);
    expect(msgs.length).toBe(1);
    expect(msgs[0]).toMatchObject({ role: "user", content: "yo" });
  });

  // Vertex/ADK request: contents + parts, plus config.system_instruction
  // surfaced as a synthetic system message.
  it("synthesises a system message from Vertex config.system_instruction", () => {
    const json = JSON.stringify({
      config: { system_instruction: "Be concise." },
      contents: [{ role: "user", parts: [{ text: "hi" }] }],
    });
    const msgs = messagesFromInput(json);
    expect(msgs[0]).toMatchObject({
      role: "system",
      content: "Be concise.",
    });
    expect(msgs[1]).toMatchObject({ role: "user", content: "hi" });
  });

  // Vertex without a system instruction still parses the contents.
  it("parses Vertex contents without system_instruction", () => {
    const json = JSON.stringify({
      contents: [{ role: "user", parts: [{ text: "hi" }] }],
    });
    const msgs = messagesFromInput(json);
    expect(msgs.length).toBe(1);
    expect(msgs[0].content).toBe("hi");
  });

  // Aliases on the role field are normalised.
  it("normalises aliased roles (human → user, model → assistant)", () => {
    const json = JSON.stringify([
      { role: "human", content: "h" },
      { role: "model", content: "m" },
    ]);
    const [m1, m2] = messagesFromInput(json);
    expect(m1.role).toBe("user");
    expect(m2.role).toBe("assistant");
  });

  // Empty/null input → empty array.
  it("returns [] for null / empty / unparseable input", () => {
    expect(messagesFromInput(null)).toEqual([]);
    expect(messagesFromInput("")).toEqual([]);
    expect(messagesFromInput("not json")).toEqual([]);
  });

  // Whitespace-only system_instruction is ignored — synthesising an empty
  // system message would clutter the head panel.
  it("ignores whitespace-only system_instruction", () => {
    const json = JSON.stringify({
      config: { system_instruction: "   " },
      contents: [{ role: "user", parts: [{ text: "x" }] }],
    });
    const msgs = messagesFromInput(json);
    expect(msgs.find((m) => m.role === "system")).toBeUndefined();
  });
});

// ===========================================================================
// messagesFromOutput
// ===========================================================================

describe("messagesFromOutput", () => {
  // Vertex/ADK envelope: { content: { role, parts } } → single message.
  it("promotes Vertex { content: {role, parts} } into a single message", () => {
    const json = JSON.stringify({
      content: { role: "model", parts: [{ text: "answer" }] },
    });
    const msgs = messagesFromOutput(json);
    expect(msgs.length).toBe(1);
    expect(msgs[0]).toMatchObject({ role: "assistant", content: "answer" });
  });

  // Anthropic-ish array of messages: parses straight through.
  it("parses an array of assistant messages", () => {
    const json = JSON.stringify([
      { role: "assistant", content: "hi" },
    ]);
    const msgs = messagesFromOutput(json);
    expect(msgs.length).toBe(1);
    expect(msgs[0].content).toBe("hi");
  });

  // OpenAI-ish single message object (treated as 1-element array).
  it("treats a single message object as a 1-element array", () => {
    const json = JSON.stringify({
      role: "assistant",
      content: "yo",
    });
    const msgs = messagesFromOutput(json);
    expect(msgs.length).toBe(1);
    expect(msgs[0].content).toBe("yo");
  });

  // No role on output → defaults to "assistant" (matches user expectation
  // for the chat view).
  it("defaults missing role to 'assistant'", () => {
    const json = JSON.stringify([{ content: "answer" }]);
    const [m] = messagesFromOutput(json);
    expect(m.role).toBe("assistant");
  });

  // Empty content → message dropped (don't render an empty bubble).
  it("drops messages with empty content", () => {
    const json = JSON.stringify([{ role: "assistant", content: "" }]);
    expect(messagesFromOutput(json)).toEqual([]);
  });

  // Vertex envelope with empty parts also drops to [].
  it("returns [] for Vertex envelope with no extractable text", () => {
    const json = JSON.stringify({
      content: { role: "model", parts: [{ function_call: { name: "f" } }] },
    });
    expect(messagesFromOutput(json)).toEqual([]);
  });

  it("returns [] for null / unparseable input", () => {
    expect(messagesFromOutput(null)).toEqual([]);
    expect(messagesFromOutput("not json")).toEqual([]);
  });
});

// ===========================================================================
// looksLikeAgentInjection
// ===========================================================================

describe("looksLikeAgentInjection", () => {
  // Bracketed envelopes are the most common — agent frameworks wrap
  // tool feedback like this.
  it.each([
    "[tool_result: success]",
    "[tool_call: lookup]",
    "[tool schemas: ...]",
    "[function_call: do_thing]",
    "[function_response: ...]",
    "[tool result: success]",
  ])('flags bracketed envelope: %s', (text) => {
    expect(looksLikeAgentInjection(text)).toBe(true);
  });

  // "For context:" prelude — agents paraphrasing prior turns.
  it.each([
    "For context: prior turn was X",
    "for context - blah",
  ])("flags 'For context' prelude: %s", (text) => {
    expect(looksLikeAgentInjection(text)).toBe(true);
  });

  // Agent quoting agent: "[agent_name] said: ..." — the regex requires
  // "said" to be immediately followed by `:` or `-` (no whitespace), so
  // `said -` (with a space) doesn't match.
  it.each([
    "[planner] said: do this",
    "agent.x said: foo",
    "[code-runner] said-bar",
  ])('flags "agent said:" pattern: %s', (text) => {
    expect(looksLikeAgentInjection(text)).toBe(true);
  });

  // Real human messages should NOT be flagged.
  it.each([
    "Hello, can you help me?",
    "Why isn't my code working?",
    "I need to query my logs for errors.",
  ])("does NOT flag genuine user message: %s", (text) => {
    expect(looksLikeAgentInjection(text)).toBe(false);
  });

  // Empty / whitespace → false (nothing to flag).
  it("returns false for empty / whitespace strings", () => {
    expect(looksLikeAgentInjection("")).toBe(false);
    expect(looksLikeAgentInjection("   ")).toBe(false);
    expect(looksLikeAgentInjection(null as any)).toBe(false);
  });

  // Only first 400 chars (after trim) are scanned — patterns appearing
  // later are ignored. Pad with non-whitespace so trim doesn't remove
  // the prefix and pull the bracketed envelope into the visible head.
  it("only inspects the first 400 chars (rest is ignored)", () => {
    const padding = "x".repeat(500);
    const text = padding + "[tool_result: x]";
    expect(looksLikeAgentInjection(text)).toBe(false);
  });
});

// ===========================================================================
// buildTraceGroup
// ===========================================================================

/** Helper to assemble a synthetic trace from arbitrary span payloads. */
function makeSpan(o: Partial<any> & { span_id: string }): any {
  return {
    trace_id: "TRACE_A",
    span_kind: "1",
    start_time: 0,
    end_time: 0,
    ...o,
  };
}

describe("buildTraceGroup", () => {
  // Empty input → null. Caller (ThreadView) skips rendering for null.
  it("returns null for empty span list", () => {
    expect(buildTraceGroup([])).toBeNull();
  });

  // No LLM-turn spans (just root + tool spans) → null. We don't render
  // a chat for non-LLM traces.
  it("returns null when no llm_turn span exists", () => {
    const spans = [
      makeSpan({ span_id: "root", span_kind: "2" }),
      makeSpan({
        span_id: "tool-1",
        gen_ai_operation_name: "execute_tool",
        reference_parent_span_id: "root",
      }),
    ];
    expect(buildTraceGroup(spans)).toBeNull();
  });

  // Minimal happy path: one LLM turn with a system prompt + user query.
  it("extracts system prompt + user query from turn 0", () => {
    const spans = [
      makeSpan({
        span_id: "root",
        span_kind: "2",
        start_time: 1000,
        end_time: 9000,
      }),
      makeSpan({
        span_id: "turn-1",
        gen_ai_operation_name: "chat",
        gen_ai_input_messages: JSON.stringify([
          { role: "system", content: "Be helpful." },
          { role: "user", content: "What is 2+2?" },
        ]),
        gen_ai_output_messages: JSON.stringify([
          { role: "assistant", content: "4" },
        ]),
        gen_ai_response_model: "gpt-4",
        gen_ai_usage_cost: 0.001,
        start_time: 1000,
        end_time: 9000,
        reference_parent_span_id: "root",
      }),
    ];
    const g = buildTraceGroup(spans)!;
    expect(g).toBeTruthy();
    expect(g.systemPrompt).toBe("Be helpful.");
    expect(g.userQuery).toBe("What is 2+2?");
    expect(g.turns.length).toBe(1);
    expect(g.turns[0].assistant[0].content).toBe("4");
    expect(g.totalCost).toBeCloseTo(0.001);
  });

  // LLM turns are sorted by start_time, regardless of array order.
  it("sorts llm turns by start_time", () => {
    const spans = [
      makeSpan({
        span_id: "turn-2",
        gen_ai_operation_name: "chat",
        gen_ai_input_messages: JSON.stringify([
          { role: "user", content: "B" },
        ]),
        start_time: 200,
      }),
      makeSpan({
        span_id: "turn-1",
        gen_ai_operation_name: "chat",
        gen_ai_input_messages: JSON.stringify([
          { role: "user", content: "A" },
        ]),
        start_time: 100,
      }),
    ];
    const g = buildTraceGroup(spans)!;
    expect(g.turns[0].span.span_id).toBe("turn-1");
    expect(g.turns[1].span.span_id).toBe("turn-2");
  });

  // Tool spans attach to their parent LLM turn via reference_parent_span_id.
  it("attaches tool spans to their parent LLM turn by parent id", () => {
    const spans = [
      makeSpan({
        span_id: "turn-1",
        gen_ai_operation_name: "chat",
        gen_ai_input_messages: JSON.stringify([
          { role: "user", content: "x" },
        ]),
        start_time: 100,
      }),
      makeSpan({
        span_id: "tool-A",
        gen_ai_operation_name: "execute_tool",
        reference_parent_span_id: "turn-1",
        start_time: 110,
      }),
      makeSpan({
        span_id: "tool-B",
        gen_ai_operation_name: "execute_tool",
        reference_parent_span_id: "turn-1",
        start_time: 120,
      }),
    ];
    const g = buildTraceGroup(spans)!;
    expect(g.turns[0].toolCalls.length).toBe(2);
    // Sorted by start_time within the turn.
    expect(g.turns[0].toolCalls.map((t) => t.span_id)).toEqual([
      "tool-A",
      "tool-B",
    ]);
  });

  // Tool spans without a matching parent_id fall back to time-window
  // matching against the LLM turns. This handles SDKs that flatten the
  // parent chain (tools listed under root, not under the LLM call).
  it("falls back to time-window match when parent_id doesn't match a turn", () => {
    const spans = [
      makeSpan({
        span_id: "turn-1",
        gen_ai_operation_name: "chat",
        gen_ai_input_messages: JSON.stringify([
          { role: "user", content: "x" },
        ]),
        start_time: 100,
      }),
      makeSpan({
        span_id: "turn-2",
        gen_ai_operation_name: "chat",
        gen_ai_input_messages: JSON.stringify([
          { role: "user", content: "y" },
        ]),
        start_time: 200,
      }),
      // tool-X has no parent_id matching either turn but is timed
      // between turn-1 and turn-2 — must attach to turn-1.
      makeSpan({
        span_id: "tool-X",
        gen_ai_operation_name: "execute_tool",
        reference_parent_span_id: "unrelated",
        start_time: 150,
      }),
    ];
    const g = buildTraceGroup(spans)!;
    expect(g.turns[0].toolCalls.map((t) => t.span_id)).toEqual(["tool-X"]);
    expect(g.turns[1].toolCalls).toEqual([]);
  });

  // Agent-injected user messages are filtered out of follow-up users
  // AND don't take over the canonical userQuery.
  it("filters agent-injection messages from userQuery selection", () => {
    const spans = [
      makeSpan({
        span_id: "turn-1",
        gen_ai_operation_name: "chat",
        gen_ai_input_messages: JSON.stringify([
          { role: "user", content: "What is 2+2?" },
          // Injected pseudo-user message — agent feedback. Must NOT
          // become the userQuery.
          { role: "user", content: "[tool_result: success]" },
        ]),
        start_time: 100,
      }),
    ];
    const g = buildTraceGroup(spans)!;
    expect(g.userQuery).toBe("What is 2+2?");
  });

  // Historical user messages (turns from prior session traces visible
  // in turn-0's input) get counted but don't pollute the chat.
  it("counts historical user messages without rendering them", () => {
    const spans = [
      makeSpan({
        span_id: "turn-1",
        gen_ai_operation_name: "chat",
        gen_ai_input_messages: JSON.stringify([
          { role: "user", content: "earlier question A" },
          { role: "assistant", content: "earlier answer" },
          { role: "user", content: "earlier question B" },
          { role: "assistant", content: "answer B" },
          { role: "user", content: "current question" },
        ]),
        start_time: 100,
      }),
    ];
    const g = buildTraceGroup(spans)!;
    expect(g.userQuery).toBe("current question");
    // The two earlier user messages are counted as historical.
    expect(g.historicalUserCount).toBe(2);
  });

  // Follow-up user messages (turns after turn-0) are deduped by
  // signature so the same message visible in N turns' inputs only
  // renders once.
  it("dedupes follow-up user messages by signature across turns", () => {
    const spans = [
      makeSpan({
        span_id: "turn-1",
        gen_ai_operation_name: "chat",
        gen_ai_input_messages: JSON.stringify([
          { role: "user", content: "Q1" },
        ]),
        start_time: 100,
      }),
      makeSpan({
        span_id: "turn-2",
        gen_ai_operation_name: "chat",
        gen_ai_input_messages: JSON.stringify([
          { role: "user", content: "Q1" },
          { role: "assistant", content: "A1" },
          { role: "user", content: "Q2-followup" },
        ]),
        start_time: 200,
      }),
      makeSpan({
        span_id: "turn-3",
        gen_ai_operation_name: "chat",
        gen_ai_input_messages: JSON.stringify([
          { role: "user", content: "Q1" },
          { role: "assistant", content: "A1" },
          { role: "user", content: "Q2-followup" }, // duplicate — must NOT render twice
          { role: "assistant", content: "A2" },
        ]),
        start_time: 300,
      }),
    ];
    const g = buildTraceGroup(spans)!;
    // turn-2 introduces Q2-followup once.
    expect(g.turns[1].followupUsers.length).toBe(1);
    expect(g.turns[1].followupUsers[0].content).toBe("Q2-followup");
    // turn-3 sees Q2-followup again but it's deduped.
    expect(g.turns[2].followupUsers.length).toBe(0);
  });

  // Per-trace aggregates: cost summed across LLM turns, duration is
  // root-span span, error count is across ALL spans (not just LLM).
  it("aggregates cost / duration / errorCount", () => {
    const spans = [
      makeSpan({
        span_id: "root",
        span_kind: "2",
        start_time: 1000,
        end_time: 9000,
      }),
      makeSpan({
        span_id: "turn-1",
        gen_ai_operation_name: "chat",
        gen_ai_input_messages: JSON.stringify([
          { role: "user", content: "x" },
        ]),
        gen_ai_usage_cost: 0.5,
        start_time: 1000,
        end_time: 5000,
        reference_parent_span_id: "root",
      }),
      makeSpan({
        span_id: "turn-2",
        gen_ai_operation_name: "chat",
        gen_ai_input_messages: JSON.stringify([
          { role: "user", content: "x" },
        ]),
        gen_ai_usage_cost: 0.25,
        start_time: 5000,
        end_time: 9000,
        reference_parent_span_id: "root",
      }),
      // Tool span errored — must contribute to the trace's errorCount.
      makeSpan({
        span_id: "tool-fail",
        gen_ai_operation_name: "execute_tool",
        reference_parent_span_id: "turn-1",
        span_status: "ERROR",
        start_time: 2000,
        end_time: 2500,
      }),
    ];
    const g = buildTraceGroup(spans)!;
    expect(g.totalCost).toBeCloseTo(0.75);
    expect(g.totalDurationNs).toBe(8000); // 9000 - 1000
    expect(g.errorCount).toBe(1);
  });

  // user identity resolution prefers email, then user_id, then various
  // gen_ai/enduser fallbacks.
  it.each([
    [{ user_email: "alice@x.com" }, "alice@x.com"],
    [{ user_id: "u-42" }, "u-42"],
    [{ gen_ai_user_id: "g-1" }, "g-1"],
    [{ enduser_id: "e-1" }, "e-1"],
    [{ user_name: "alice" }, "alice"],
    [{}, ""],
  ])("resolves userId via fallback chain: %s → %s", (rootExtras, expected) => {
    const spans = [
      makeSpan({
        span_id: "root",
        span_kind: "2",
        start_time: 1000,
        end_time: 2000,
        ...rootExtras,
      }),
      makeSpan({
        span_id: "turn-1",
        gen_ai_operation_name: "chat",
        gen_ai_input_messages: JSON.stringify([
          { role: "user", content: "x" },
        ]),
        start_time: 1000,
        end_time: 2000,
        reference_parent_span_id: "root",
      }),
    ];
    const g = buildTraceGroup(spans)!;
    expect(g.userId).toBe(expected);
  });

  // Explicit user_query on the root span wins over message-derived
  // detection — operators/SDK can override what gets shown.
  it("prefers explicit root.user_query over message-derived userQuery", () => {
    const spans = [
      makeSpan({
        span_id: "root",
        span_kind: "2",
        user_query: "EXPLICIT QUESTION",
        start_time: 100,
      }),
      makeSpan({
        span_id: "turn-1",
        gen_ai_operation_name: "chat",
        gen_ai_input_messages: JSON.stringify([
          { role: "user", content: "derived question" },
        ]),
        start_time: 100,
        reference_parent_span_id: "root",
      }),
    ];
    const g = buildTraceGroup(spans)!;
    expect(g.userQuery).toBe("EXPLICIT QUESTION");
  });
});
