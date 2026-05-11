// Copyright 2026 OpenObserve Inc.
//
// Tests for `resolveSessionId` — the helper that picks the conversation/
// session ID to display in the trace-details header.

import { describe, it, expect } from "vitest";
import { resolveSessionId } from "./traceDetails.utils";

describe("resolveSessionId", () => {
  // Empty / null / undefined inputs → "" so the header template hides
  // the chip via v-if instead of showing an empty cell.
  it.each([
    [null],
    [undefined],
    [[]],
  ])("returns empty string for %j", (input) => {
    expect(resolveSessionId(input as any)).toBe("");
  });

  // Preferred path: OTEL gen_ai_conversation_id on any span.
  it("returns gen_ai_conversation_id when present on any span", () => {
    const spans = [
      { trace_id: "t-1", span_id: "s-1" },
      { gen_ai_conversation_id: "conv-abc", span_id: "s-2" },
    ];
    expect(resolveSessionId(spans)).toBe("conv-abc");
  });

  // Legacy fallback: session_id when gen_ai_conversation_id isn't set.
  it("falls back to legacy session_id when gen_ai_conversation_id is absent", () => {
    const spans = [
      { trace_id: "t-1" },
      { session_id: "legacy-sess-42" },
    ];
    expect(resolveSessionId(spans)).toBe("legacy-sess-42");
  });

  // Both fields present on the same span: prefer gen_ai (OTEL spec).
  it("prefers gen_ai_conversation_id over session_id on the same span", () => {
    const spans = [
      { gen_ai_conversation_id: "new-id", session_id: "old-id" },
    ];
    expect(resolveSessionId(spans)).toBe("new-id");
  });

  // First span with EITHER field wins — even if a later span has a
  // different value. Scanning order matches the array order, which
  // matches the trace's ingestion order.
  it("returns the first span's value when multiple spans have IDs", () => {
    const spans = [
      { gen_ai_conversation_id: "first" },
      { gen_ai_conversation_id: "second" },
    ];
    expect(resolveSessionId(spans)).toBe("first");
  });

  // Spans WITHOUT either field are skipped during the find.
  it("skips spans without either field", () => {
    const spans = [
      { trace_id: "t-1" },
      { trace_id: "t-2" },
      { trace_id: "t-3", session_id: "found-it" },
    ];
    expect(resolveSessionId(spans)).toBe("found-it");
  });

  // No span carries either field → "".
  it("returns empty string when no span has session/conversation id", () => {
    const spans = [
      { trace_id: "t-1" },
      { trace_id: "t-2", operation_name: "GET /api" },
    ];
    expect(resolveSessionId(spans)).toBe("");
  });

  // Numeric / non-string IDs are coerced to string (the header chip
  // uses the result as a `:title` and inside a `<span>{{ ... }}</span>`).
  it("stringifies numeric IDs", () => {
    const spans = [{ session_id: 12345 }];
    expect(resolveSessionId(spans)).toBe("12345");
  });

  // Defensive: spans that are themselves null/undefined inside the
  // array don't crash the find — the optional chains in the predicate
  // skip them. This shouldn't happen in practice but better to be safe.
  it("tolerates null / undefined spans in the array", () => {
    const spans = [null, undefined, { gen_ai_conversation_id: "ok" }];
    expect(resolveSessionId(spans as any)).toBe("ok");
  });

  // Empty-string IDs are treated as "no value" because both branches
  // of the predicate use `||` (truthy check). This means a span with
  // explicit empty session_id is skipped. Pin this behaviour.
  it("treats empty-string IDs as missing", () => {
    const spans = [
      { session_id: "" },
      { session_id: "real" },
    ];
    expect(resolveSessionId(spans)).toBe("real");
  });
});
