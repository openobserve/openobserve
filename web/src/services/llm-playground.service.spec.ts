// Copyright 2026 OpenObserve Inc.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/stores", () => ({ default: { state: { API_ENDPOINT: "http://api.test" } } }));
vi.mock("@/services/http", () => ({ attemptTokenRefresh: vi.fn() }));

import {
  PlaygroundRunError,
  runPlayground,
  type PlaygroundRunRequest,
  type PlaygroundRunResult,
} from "./llm-playground.service";

function request(overrides: Partial<PlaygroundRunRequest> = {}): PlaygroundRunRequest {
  return {
    providerId: "provider-1",
    model: "gpt-4o-mini",
    messages: [
      { role: "system", content: "You are terse." },
      { role: "user", content: "What is the refund window?" },
    ],
    params: { temperature: 0 },
    ...overrides,
  };
}

/**
 * Drives the mock's timers to completion. The run resolves from inside a timer
 * callback, so each advance is awaited to let the microtask queue drain.
 */
async function settle<T>(
  promise: Promise<T>,
): Promise<{ ok: true; value: T } | { ok: false; error: unknown }> {
  const outcome = promise.then(
    (value) => ({ ok: true as const, value }),
    (error) => ({ ok: false as const, error }),
  );
  for (let tick = 0; tick < 200; tick += 1) {
    await vi.advanceTimersByTimeAsync(40);
    const settled = await Promise.race([outcome, Promise.resolve(null)]);
    if (settled) return settled;
  }
  return outcome;
}

describe("runPlayground — mock adapter", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("streams the answer in chunks whose concatenation is the final text", async () => {
    const chunks: string[] = [];
    const settled = await settle(
      runPlayground("org", request(), { onDelta: (text) => chunks.push(text) }),
    );

    expect(settled.ok).toBe(true);
    const result = (settled as { ok: true; value: PlaygroundRunResult }).value;
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.join("")).toBe(result.text);
    expect(result.text.length).toBeGreaterThan(0);
    expect(result.toolCall).toBeNull();
  });

  it("reports usage that matches the produced output", async () => {
    const settled = await settle(runPlayground("org", request(), { onDelta: () => {} }));
    const result = (settled as { ok: true; value: PlaygroundRunResult }).value;

    expect(result.usage.promptTokens).toBeGreaterThan(0);
    expect(result.usage.completionTokens).toBe(Math.ceil(result.text.length / 4));
    expect(result.usage.costUsd).toBeGreaterThan(0);
    expect(result.usage.latencyMs).toBeGreaterThan(0);
  });

  it("is deterministic — the same request produces the same output", async () => {
    const first = await settle(runPlayground("org", request(), { onDelta: () => {} }));
    const second = await settle(runPlayground("org", request(), { onDelta: () => {} }));

    expect((first as { value: PlaygroundRunResult }).value.text).toBe(
      (second as { value: PlaygroundRunResult }).value.text,
    );
  });

  it("produces different output for a different prompt", async () => {
    const a = await settle(runPlayground("org", request(), { onDelta: () => {} }));
    const b = await settle(
      runPlayground(
        "org",
        request({ messages: [{ role: "user", content: "Something else entirely" }] }),
        { onDelta: () => {} },
      ),
    );

    expect((a as { value: PlaygroundRunResult }).value.text).not.toBe(
      (b as { value: PlaygroundRunResult }).value.text,
    );
  });

  it("returns JSON when a response schema is set", async () => {
    const settled = await settle(
      runPlayground("org", request({ responseSchema: { type: "object" } }), {
        onDelta: () => {},
      }),
    );
    const result = (settled as { ok: true; value: PlaygroundRunResult }).value;

    expect(() => JSON.parse(result.text)).not.toThrow();
    expect(JSON.parse(result.text)).toHaveProperty("answer");
  });

  it("ends the run at the tool call instead of answering, and emits no text", async () => {
    const chunks: string[] = [];
    const settled = await settle(
      runPlayground(
        "org",
        request({
          tools: [{ name: "lookup_order", description: "", parameters: { type: "object" } }],
        }),
        { onDelta: (text) => chunks.push(text) },
      ),
    );
    const result = (settled as { ok: true; value: PlaygroundRunResult }).value;

    expect(result.toolCall).toEqual({
      name: "lookup_order",
      arguments: '{ "order_id": "SH202604280912" }',
    });
    expect(result.text).toBe("");
    expect(chunks).toEqual([]);
  });

  it("answers normally once a tool result is already in the conversation", async () => {
    const settled = await settle(
      runPlayground(
        "org",
        request({
          tools: [{ name: "lookup_order", description: "", parameters: {} }],
          messages: [
            { role: "user", content: "Where is my order?" },
            { role: "tool", content: '{"status":"shipped"}' },
          ],
        }),
        { onDelta: () => {} },
      ),
    );
    const result = (settled as { ok: true; value: PlaygroundRunResult }).value;

    expect(result.toolCall).toBeNull();
    expect(result.text.length).toBeGreaterThan(0);
  });

  it("rejects with a retryable PlaygroundRunError for the seeded failure case", async () => {
    // The failure is seeded off the request, so we search for a prompt that
    // lands in the failing 8% rather than forcing it and testing nothing.
    let failure: unknown = null;
    for (let attempt = 0; attempt < 60 && failure === null; attempt += 1) {
      const settled = await settle(
        runPlayground(
          "org",
          request({ messages: [{ role: "user", content: `probe ${attempt}` }] }),
          { onDelta: () => {} },
        ),
      );
      if (!settled.ok) failure = settled.error;
    }

    expect(failure).toBeInstanceOf(PlaygroundRunError);
    expect((failure as PlaygroundRunError).retryable).toBe(true);
  });

  it("rejects immediately when handed an already-aborted signal", async () => {
    const controller = new AbortController();
    controller.abort();

    await expect(
      runPlayground("org", request(), { onDelta: () => {}, signal: controller.signal }),
    ).rejects.toMatchObject({ name: "AbortError" });
  });

  it("stops streaming and rejects when aborted mid-run", async () => {
    const controller = new AbortController();
    const chunks: string[] = [];
    const run = runPlayground("org", request(), {
      onDelta: (text) => chunks.push(text),
      signal: controller.signal,
    });
    const outcome = run.then(
      () => "resolved",
      (error: Error) => error.name,
    );

    await vi.advanceTimersByTimeAsync(40);
    const received = chunks.length;
    controller.abort();
    await vi.advanceTimersByTimeAsync(400);

    expect(await outcome).toBe("AbortError");
    expect(chunks.length).toBe(received);
  });
});
