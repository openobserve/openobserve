// Copyright 2026 OpenObserve Inc.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/stores", () => ({ default: { state: { API_ENDPOINT: "http://api.test" } } }));
vi.mock("@/services/http", () => ({ attemptTokenRefresh: vi.fn() }));

import {
  PlaygroundRunError,
  runPlayground,
  runPlaygroundMock,
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
      runPlaygroundMock(request(), { onDelta: (text) => chunks.push(text) }),
    );

    expect(settled.ok).toBe(true);
    const result = (settled as { ok: true; value: PlaygroundRunResult }).value;
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.join("")).toBe(result.text);
    expect(result.text.length).toBeGreaterThan(0);
    expect(result.toolCall).toBeNull();
  });

  it("reports usage that matches the produced output", async () => {
    const settled = await settle(runPlaygroundMock(request(), { onDelta: () => {} }));
    const result = (settled as { ok: true; value: PlaygroundRunResult }).value;

    expect(result.usage.promptTokens).toBeGreaterThan(0);
    expect(result.usage.completionTokens).toBe(Math.ceil(result.text.length / 4));
    expect(result.usage.costUsd).toBeGreaterThan(0);
    expect(result.usage.latencyMs).toBeGreaterThan(0);
  });

  it("is deterministic — the same request produces the same output", async () => {
    const first = await settle(runPlaygroundMock(request(), { onDelta: () => {} }));
    const second = await settle(runPlaygroundMock(request(), { onDelta: () => {} }));

    expect((first as { value: PlaygroundRunResult }).value.text).toBe(
      (second as { value: PlaygroundRunResult }).value.text,
    );
  });

  it("produces different output for a different prompt", async () => {
    const a = await settle(runPlaygroundMock(request(), { onDelta: () => {} }));
    const b = await settle(
      runPlaygroundMock(
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
      runPlaygroundMock(request({ responseSchema: { type: "object" } }), {
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
      runPlaygroundMock(
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
      runPlaygroundMock(
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
        runPlaygroundMock(
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
      runPlaygroundMock(request(), { onDelta: () => {}, signal: controller.signal }),
    ).rejects.toMatchObject({ name: "AbortError" });
  });

  it("stops streaming and rejects when aborted mid-run", async () => {
    const controller = new AbortController();
    const chunks: string[] = [];
    const run = runPlaygroundMock(request(), {
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

// ── live adapter ──────────────────────────────────────────────────

/**
 * A reader over pre-baked chunks. Built by hand rather than with `Response`, so
 * a test controls exactly where a chunk boundary falls — the interesting case
 * is an SSE frame split across two reads.
 */
function streamOf(chunks: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  let index = 0;
  return {
    getReader: () => ({
      read: async () =>
        index < chunks.length
          ? { done: false, value: encoder.encode(chunks[index++]) }
          : { done: true, value: undefined },
    }),
  } as unknown as ReadableStream<Uint8Array>;
}

function streamingResponse(chunks: string[]): Response {
  return { ok: true, status: 200, body: streamOf(chunks) } as unknown as Response;
}

function failureResponse(status: number, body: string): Response {
  return { ok: false, status, text: async () => body } as unknown as Response;
}

/** One SSE frame exactly as the server writes it: `data:` only, no `event:`. */
function frame(payload: Record<string, unknown>): string {
  return `data: ${JSON.stringify(payload)}\n\n`;
}

function stubFetch(response: Response) {
  const fetchMock = vi.fn().mockResolvedValue(response);
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function sentBody(fetchMock: ReturnType<typeof vi.fn>): any {
  return JSON.parse(fetchMock.mock.calls[0][1].body as string);
}

describe("runPlayground — live adapter", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("accumulates delta frames discriminated by `type`, not by an event: line", async () => {
    stubFetch(
      streamingResponse([
        frame({ type: "rendered", messages: [{ role: "user", content: "hi" }] }),
        frame({ type: "delta", content: "Refunds " }),
        frame({ type: "delta", content: "take 30 days." }),
        frame({ type: "done", latencyMs: 812, usage: {} }),
      ]),
    );

    const chunks: string[] = [];
    const result = await runPlayground("org", request(), {
      onDelta: (text) => chunks.push(text),
    });

    expect(chunks).toEqual(["Refunds ", "take 30 days."]);
    expect(result.text).toBe("Refunds take 30 days.");
    expect(result.toolCall).toBeNull();
  });

  it("reassembles a frame split across chunk boundaries", async () => {
    stubFetch(
      streamingResponse([
        'data: {"type":"delta","con',
        'tent":"split"}\n\ndata: {"type":"done","latencyMs":5,"usage":{}}\n\n',
      ]),
    );

    const result = await runPlayground("org", request(), { onDelta: () => {} });

    expect(result.text).toBe("split");
  });

  it("maps the done frame's accounting, reading `cost` as the dollar figure", async () => {
    stubFetch(
      streamingResponse([
        frame({ type: "delta", content: "ok" }),
        frame({
          type: "done",
          latencyMs: 812,
          usage: { promptTokens: 11, completionTokens: 3, totalTokens: 14, cost: 0.0004 },
        }),
      ]),
    );

    const result = await runPlayground("org", request(), { onDelta: () => {} });

    expect(result.usage).toEqual({
      promptTokens: 11,
      completionTokens: 3,
      costUsd: 0.0004,
      latencyMs: 812,
    });
  });

  it("reads a null cost as zero, which is what an unpriced model reports", async () => {
    stubFetch(
      streamingResponse([
        frame({
          type: "done",
          latencyMs: 5,
          usage: { promptTokens: 2, completionTokens: 1, cost: null },
        }),
      ]),
    );

    const result = await runPlayground("org", request(), { onDelta: () => {} });

    expect(result.usage.costUsd).toBe(0);
  });

  it("surfaces a tool call as the output and keeps the first when several arrive", async () => {
    stubFetch(
      streamingResponse([
        frame({
          type: "toolCall",
          id: "call_1",
          name: "get_weather",
          arguments: '{"city":"Paris"}',
        }),
        frame({ type: "toolCall", id: "call_2", name: "other", arguments: "{}" }),
        frame({ type: "done", latencyMs: 9, usage: {} }),
      ]),
    );

    const result = await runPlayground("org", request(), { onDelta: () => {} });

    expect(result.toolCall).toEqual({ name: "get_weather", arguments: '{"city":"Paris"}' });
    expect(result.text).toBe("");
  });

  it("throws a retryable error for an error frame inside an open stream", async () => {
    stubFetch(
      streamingResponse([
        frame({ type: "delta", content: "partial" }),
        frame({ type: "error", error: "provider stream ended unexpectedly" }),
      ]),
    );

    await expect(runPlayground("org", request(), { onDelta: () => {} })).rejects.toMatchObject({
      name: "PlaygroundRunError",
      message: "provider stream ended unexpectedly",
      retryable: true,
    });
  });

  it("reports the server's own message when the run is rejected before the stream opens", async () => {
    stubFetch(
      failureResponse(
        400,
        JSON.stringify({ code: 400, message: "Prompt contains an unresolved template variable" }),
      ),
    );

    const failure = await runPlayground("org", request(), { onDelta: () => {} }).catch((e) => e);

    expect(failure).toBeInstanceOf(PlaygroundRunError);
    expect(failure.message).toBe("Prompt contains an unresolved template variable");
    // A rejected request is the caller's to fix, so retrying it is pointless.
    expect(failure.retryable).toBe(false);
  });

  it("marks a rate limit and a server fault as retryable", async () => {
    stubFetch(failureResponse(429, "{}"));
    const rateLimited = await runPlayground("org", request(), { onDelta: () => {} }).catch((e) => e);
    expect(rateLimited.retryable).toBe(true);

    vi.unstubAllGlobals();
    stubFetch(failureResponse(503, "{}"));
    const unavailable = await runPlayground("org", request(), { onDelta: () => {} }).catch((e) => e);
    expect(unavailable.retryable).toBe(true);
  });

  it("nests the request under `column` and sends no `row`", async () => {
    const fetchMock = stubFetch(
      streamingResponse([frame({ type: "done", latencyMs: 1, usage: {} })]),
    );

    await runPlayground("org", request(), { onDelta: () => {} });

    const body = sentBody(fetchMock);
    expect(Object.keys(body)).toEqual(["column"]);
    expect(body.column.providerId).toBe("provider-1");
    expect(body.column.model).toBe("gpt-4o-mini");
    expect(body.column.params).toEqual({ temperature: 0 });
    expect(body.column.messages).toEqual([
      { role: "system", content: "You are terse." },
      { role: "user", content: "What is the refund window?" },
    ]);
    // The client has already bound every {{token}}; a row would bind them twice.
    expect(body.row).toBeUndefined();
    expect(fetchMock.mock.calls[0][0]).toBe("http://api.test/api/org/playground/run");
  });

  it("omits an empty model so the provider's default stands in", async () => {
    const fetchMock = stubFetch(
      streamingResponse([frame({ type: "done", latencyMs: 1, usage: {} })]),
    );

    await runPlayground("org", request({ model: "" }), { onDelta: () => {} });

    expect(sentBody(fetchMock).column.model).toBeUndefined();
  });

  it("wraps tools and the response schema the way an OpenAI-compatible provider expects", async () => {
    const fetchMock = stubFetch(
      streamingResponse([frame({ type: "done", latencyMs: 1, usage: {} })]),
    );

    await runPlayground(
      "org",
      request({
        providerType: "openai",
        tools: [{ name: "lookup", description: "Find it", parameters: { type: "object" } }],
        responseSchema: { type: "object" },
      }),
      { onDelta: () => {} },
    );

    const column = sentBody(fetchMock).column;
    expect(column.tools).toEqual([
      {
        type: "function",
        function: { name: "lookup", description: "Find it", parameters: { type: "object" } },
      },
    ]);
    expect(column.responseFormat).toEqual({
      type: "json_schema",
      json_schema: { name: "playground_response", schema: { type: "object" }, strict: false },
    });
  });

  it("uses Anthropic's flat tool shape and drops the response format it cannot express", async () => {
    const fetchMock = stubFetch(
      streamingResponse([frame({ type: "done", latencyMs: 1, usage: {} })]),
    );

    await runPlayground(
      "org",
      request({
        providerType: "Anthropic",
        tools: [{ name: "lookup", description: "Find it", parameters: { type: "object" } }],
        responseSchema: { type: "object" },
      }),
      { onDelta: () => {} },
    );

    const column = sentBody(fetchMock).column;
    expect(column.tools).toEqual([
      { name: "lookup", description: "Find it", input_schema: { type: "object" } },
    ]);
    expect(column.responseFormat).toBeUndefined();
  });

  it("sends no tools key at all when the bench defines none", async () => {
    const fetchMock = stubFetch(
      streamingResponse([frame({ type: "done", latencyMs: 1, usage: {} })]),
    );

    await runPlayground("org", request({ tools: [] }), { onDelta: () => {} });

    expect(sentBody(fetchMock).column.tools).toBeUndefined();
  });
});
