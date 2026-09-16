// Copyright 2026 OpenObserve Inc.

import { beforeEach, describe, expect, it } from "vitest";
import { handoffFromSpan, stashHandoff, takeHandoff } from "./playgroundHandoff";

describe("handoffFromSpan", () => {
  it("carries the input turns and the answer as ordinary editable messages", () => {
    const handoff = handoffFromSpan({
      span_id: "span-1",
      gen_ai_request_model: "gpt-4o-mini",
      gen_ai_input_messages: [
        { role: "system", content: "Be brief." },
        { role: "user", content: "Why is the sky blue?" },
      ],
      gen_ai_output_messages: { role: "assistant", content: "Rayleigh scattering." },
      llm_request_parameters: { temperature: 0.2 },
    });

    expect(handoff?.messages.map((m) => [m.role, m.content])).toEqual([
      ["system", "Be brief."],
      ["user", "Why is the sky blue?"],
      ["assistant", "Rayleigh scattering."],
    ]);
    // Nothing is pinned: the entry exists so the call can be CHANGED and re-run.
    expect(handoff?.messages.every((m) => !m.readonly)).toBe(true);
    expect(handoff?.temperature).toBe("0.2");
  });

  it("leaves the provider and model to the bench's own default", () => {
    // A trace records whatever served it in production. Carrying that model over
    // points the bench at a provider the user may not have configured, and the
    // failure would only surface at Run.
    const handoff = handoffFromSpan({
      span_id: "s",
      gen_ai_request_model: "gpt-4o-mini",
      gen_ai_input_messages: [{ role: "user", content: "hi" }],
    });
    expect(handoff).not.toHaveProperty("model");
  });

  it("parses messages that arrive as a JSON string", () => {
    const handoff = handoffFromSpan({
      span_id: "span-2",
      gen_ai_input_messages: JSON.stringify([{ role: "user", content: "hi" }]),
    });
    expect(handoff?.messages.map((m) => m.role)).toEqual(["system", "user"]);
    expect(handoff?.messages[1].content).toBe("hi");
  });

  it("keeps a bare prompt string as a message instead of dropping it", () => {
    const handoff = handoffFromSpan({ span_id: "s", gen_ai_input_messages: "just text" });
    expect(handoff?.messages).toEqual([
      expect.objectContaining({ role: "system", content: "" }),
      expect.objectContaining({ role: "user", content: "just text" }),
    ]);
  });

  it("flattens multimodal content to the text the bench can edit", () => {
    const handoff = handoffFromSpan({
      span_id: "s",
      gen_ai_input_messages: [
        {
          role: "user",
          content: [
            { type: "text", text: "part one" },
            { type: "text", text: "part two" },
          ],
        },
      ],
    });
    expect(handoff?.messages[1].content).toBe("part one\n\npart two");
  });

  it("maps Gemini's `model` role onto assistant", () => {
    const handoff = handoffFromSpan({
      span_id: "s",
      gen_ai_input_messages: [{ role: "user", content: "q" }],
      gen_ai_output_messages: [{ role: "model", content: "a" }],
    });
    expect(handoff?.messages[2].role).toBe("assistant");
  });

  it("falls back to the evaluator attributes a non-GenAI span uses", () => {
    const handoff = handoffFromSpan({
      span_id: "s",
      attributes_prompt: "graded prompt",
      attributes_response: "graded answer",
    });
    expect(handoff?.messages.map((m) => m.role)).toEqual(["system", "user", "assistant"]);
  });

  it("always yields a system row, empty when the span had none", () => {
    const handoff = handoffFromSpan({
      span_id: "s",
      gen_ai_input_messages: [{ role: "user", content: "Hello how are you" }],
    });

    // The bench needs somewhere to type a system prompt even when the trace had
    // none — no row at all reads as the import having lost it.
    expect(handoff?.messages[0]).toMatchObject({ role: "system", content: "" });
    expect(handoff?.messages.filter((m) => m.role === "system")).toHaveLength(1);
  });

  it("imports system instructions from their own span field", () => {
    // Providers that keep the system turn out of the messages array put it
    // here; reading only gen_ai_input_messages drops the prompt that shaped
    // the answer.
    const handoff = handoffFromSpan({
      span_id: "s",
      gen_ai_system_instructions: [
        { type: "text", content: "You are an SRE assistant." },
        { type: "text", content: "Be concise." },
      ],
      gen_ai_input_messages: [{ role: "user", content: "hi" }],
    });

    expect(handoff?.messages[0]).toMatchObject({
      role: "system",
      content: "You are an SRE assistant.\n\nBe concise.",
    });
  });

  it("keeps the messages array's own system turn over the separate field", () => {
    const handoff = handoffFromSpan({
      span_id: "s",
      gen_ai_system_instructions: "from the field",
      gen_ai_input_messages: [
        { role: "system", content: "from the messages" },
        { role: "user", content: "hi" },
      ],
    });

    expect(handoff?.messages[0].content).toBe("from the messages");
    expect(handoff?.messages.filter((m) => m.role === "system")).toHaveLength(1);
  });

  it("hoists a system turn to the top even when the span lists it later", () => {
    const handoff = handoffFromSpan({
      span_id: "s",
      gen_ai_input_messages: [
        { role: "user", content: "hi" },
        { role: "system", content: "rules" },
      ],
    });
    expect(handoff?.messages.map((m) => m.role)).toEqual(["system", "user"]);
  });

  it("returns null when the span carries no conversation", () => {
    expect(handoffFromSpan({ span_id: "s", gen_ai_request_model: "gpt-4o" })).toBeNull();
    expect(handoffFromSpan(null)).toBeNull();
  });
});

describe("stash / take", () => {
  beforeEach(() => sessionStorage.clear());

  it("round-trips a hand-off", () => {
    const handoff = handoffFromSpan({
      span_id: "s",
      gen_ai_input_messages: [{ role: "user", content: "hello" }],
    })!;
    expect(stashHandoff(handoff)).toBe(true);
    expect(takeHandoff()?.messages[1].content).toBe("hello");
  });

  it("consumes the hand-off so a refresh cannot re-import over later edits", () => {
    stashHandoff(
      handoffFromSpan({ span_id: "s", gen_ai_input_messages: [{ role: "user", content: "x" }] })!,
    );
    expect(takeHandoff()).not.toBeNull();
    expect(takeHandoff()).toBeNull();
  });

  it("regenerates message ids so they cannot collide with a restored session", () => {
    const handoff = handoffFromSpan({
      span_id: "s",
      gen_ai_input_messages: [{ role: "user", content: "x" }],
    })!;
    const originalId = handoff.messages[0].id;
    stashHandoff(handoff);
    expect(takeHandoff()?.messages[0].id).not.toBe(originalId);
  });

  it("reports nothing rather than throwing on unreadable storage", () => {
    sessionStorage.setItem("o2-playground-handoff", "{not json");
    expect(takeHandoff()).toBeNull();
  });
});
