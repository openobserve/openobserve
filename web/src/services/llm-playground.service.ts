// Copyright 2026 OpenObserve Inc.
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.

/**
 * Playground run and score contract.
 *
 * Speaks to `POST /api/{org}/playground/run`, which streams Server-Sent
 * Events. The server is the source of truth for this shape: it nests the
 * request under `column`/`row`, discriminates frames on a `type` field inside
 * the data payload rather than an `event:` line, and passes `tools` and
 * `responseFormat` through to the provider verbatim — so the wire shaping for
 * those lives here, keyed on the provider's type.
 *
 * The mock adapter below stays for tests and for working offline; flip
 * `PLAYGROUND_USE_MOCK` to reach it.
 */

import store from "@/stores";
import http, { attemptTokenRefresh } from "@/services/http";

/** Set true to run against the deterministic mock instead of the live route. */
export const PLAYGROUND_USE_MOCK = false;

export type PlaygroundMessageRole = "system" | "user" | "assistant" | "tool";

export interface PlaygroundRequestMessage {
  role: PlaygroundMessageRole;
  content: string;
}

export interface PlaygroundRequestTool {
  name: string;
  description: string;
  /** Parameter JSON schema, already parsed. */
  parameters: unknown;
}

export interface PlaygroundRunRequest {
  providerId: string;
  /** Decides how `tools` and `responseSchema` are shaped for the wire. Absent
   *  is treated as OpenAI-compatible, which is what every provider kind the
   *  server does not special-case falls back to. */
  providerType?: string;
  model: string;
  /** Already rendered: `{{tokens}}` are substituted client-side, so the server
   *  binds nothing and `row` is omitted from the request. */
  messages: PlaygroundRequestMessage[];
  params: { temperature?: number; maxTokens?: number };
  /** Definitions only. The Playground never executes a tool — see `toolCall`. */
  tools?: PlaygroundRequestTool[];
  responseSchema?: unknown | null;
}

export interface PlaygroundRunUsage {
  promptTokens: number;
  completionTokens: number;
  costUsd: number;
  latencyMs: number;
}

export interface PlaygroundRunToolCall {
  name: string;
  arguments: string;
}

export interface PlaygroundRunResult {
  text: string;
  /** Non-null when the model issued a tool call. The call IS the output and the
   *  run ends there — the Playground does not execute tools. */
  toolCall: PlaygroundRunToolCall | null;
  usage: PlaygroundRunUsage;
}

export interface PlaygroundRunOptions {
  /** Called with each incremental chunk of text as it arrives. */
  onDelta: (text: string) => void;
  signal?: AbortSignal;
}

/** A run that failed in a way the caller may retry (rate limit, timeout). */
export class PlaygroundRunError extends Error {
  readonly retryable: boolean;

  constructor(message: string, retryable: boolean) {
    super(message);
    this.name = "PlaygroundRunError";
    this.retryable = retryable;
  }
}

export function runPlayground(
  orgId: string,
  request: PlaygroundRunRequest,
  options: PlaygroundRunOptions,
): Promise<PlaygroundRunResult> {
  return PLAYGROUND_USE_MOCK
    ? runPlaygroundMock(request, options)
    : runLive(orgId, request, options);
}

// ── scoring ───────────────────────────────────────────────────────

export interface PlaygroundScoreRequest {
  /** Resolved at their latest version — a draft never pins one. */
  scorerIds: string[];
  input?: unknown;
  output: string;
  expectedOutput?: unknown;
  metadata?: unknown;
}

/** One scorer's verdict. A scorer that could not run says why rather than
 *  vanishing from the response, so the caller can show the reason. */
export interface PlaygroundScoreResult {
  scorerId: string;
  scorerName: string;
  scorerVersion: number;
  status: "scored" | "skipped" | "failed";
  numeric: number | null;
  categorical: string | null;
  boolean: boolean | null;
  reasoning: string | null;
  /** `skipped` only. */
  reason: "no_reference" | "requires_trace" | null;
  /** `failed` only. */
  error: string | null;
}

/**
 * Judge one output. Records nothing: a draft verdict must not reach the score
 * stream the analytics are built on.
 */
export async function scorePlayground(
  orgId: string,
  request: PlaygroundScoreRequest,
): Promise<PlaygroundScoreResult[]> {
  const response = await http().post(`/api/${orgId}/playground/score`, request);
  const results = Array.isArray(response.data?.results) ? response.data.results : [];
  return results.map(normalizeScore);
}

function normalizeScore(row: any): PlaygroundScoreResult {
  // `status` and the value fields arrive flattened onto one object, so a
  // `scored` row and a `failed` row are told apart only by this field.
  const status = row?.status === "skipped" || row?.status === "failed" ? row.status : "scored";
  return {
    scorerId: String(row?.scorerId ?? row?.scorer_id ?? ""),
    scorerName: String(row?.scorerName ?? row?.scorer_name ?? ""),
    scorerVersion: Number(row?.scorerVersion ?? row?.scorer_version ?? 0),
    status,
    numeric: typeof row?.numeric === "number" ? row.numeric : null,
    categorical: typeof row?.categorical === "string" ? row.categorical : null,
    boolean: typeof row?.boolean === "boolean" ? row.boolean : null,
    reasoning: typeof row?.reasoning === "string" ? row.reasoning : null,
    reason: row?.reason === "no_reference" || row?.reason === "requires_trace" ? row.reason : null,
    error: typeof row?.error === "string" ? row.error : null,
  };
}

// ── wire shaping ──────────────────────────────────────────────────

/** Provider kinds the server does NOT route through its OpenAI-compatible body
 *  builder. Everything else — OpenAI, DeepSeek, Azure, gateways, the test mock
 *  — takes the `chat/completions` shape. */
const ANTHROPIC_KIND = "anthropic";

function providerKind(request: PlaygroundRunRequest): string {
  return (request.providerType ?? "").trim().toLowerCase();
}

/**
 * Tool definitions in the provider's own shape.
 *
 * The server merges this straight into the provider request body, so the shape
 * has to be the provider's, not ours: OpenAI nests under `function`, Anthropic
 * takes the schema flat as `input_schema`.
 */
function wireTools(request: PlaygroundRunRequest): unknown[] | undefined {
  const tools = request.tools?.filter((tool) => tool.name.trim().length > 0);
  if (!tools?.length) return undefined;

  if (providerKind(request) === ANTHROPIC_KIND) {
    return tools.map((tool) => ({
      name: tool.name,
      description: tool.description,
      input_schema: tool.parameters,
    }));
  }
  return tools.map((tool) => ({
    type: "function",
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters,
    },
  }));
}

/**
 * The response-format field, or undefined when this provider has none.
 *
 * Anthropic has no `response_format`; structured output there is expressed as a
 * forced tool call, which the Playground has no UI for. Sending the schema
 * anyway would earn a provider 400, so it is dropped and reported.
 */
function wireResponseFormat(request: PlaygroundRunRequest): unknown | undefined {
  if (!request.responseSchema) return undefined;
  if (providerKind(request) === ANTHROPIC_KIND) return undefined;
  return {
    type: "json_schema",
    json_schema: {
      name: "playground_response",
      schema: request.responseSchema,
      strict: false,
    },
  };
}

/** True when a response schema was asked for but this provider cannot carry it. */
export function dropsResponseSchema(request: PlaygroundRunRequest): boolean {
  return Boolean(request.responseSchema) && providerKind(request) === ANTHROPIC_KIND;
}

/**
 * The request body the server accepts.
 *
 * `column` rejects unknown fields, so nothing may be added here that the server
 * does not declare. `row` is omitted entirely: the client has already bound
 * every `{{token}}`, and handing the server an input to bind again would run
 * the substitution twice.
 */
function wireBody(request: PlaygroundRunRequest): Record<string, unknown> {
  const column: Record<string, unknown> = {
    providerId: request.providerId,
    messages: request.messages.map((message) => ({
      role: message.role,
      content: message.content,
    })),
    params: {
      temperature: request.params.temperature ?? 0,
      ...(request.params.maxTokens ? { max_tokens: request.params.maxTokens } : {}),
    },
  };

  // An empty model would fail the server's model validation; omitting it lets
  // the provider's configured default stand in.
  if (request.model) column.model = request.model;

  const tools = wireTools(request);
  if (tools) column.tools = tools;

  const responseFormat = wireResponseFormat(request);
  if (responseFormat) column.responseFormat = responseFormat;

  return { column };
}

// ── live adapter ──────────────────────────────────────────────────

/**
 * SSE over `fetch`, matching how `useStreamingSearch` consumes streams: a 401
 * refreshes the token once and retries, because the axios interceptor that
 * normally does this never sees a `fetch` request.
 */
async function runLive(
  orgId: string,
  request: PlaygroundRunRequest,
  { onDelta, signal }: PlaygroundRunOptions,
): Promise<PlaygroundRunResult> {
  const url = `${store.state.API_ENDPOINT}/api/${orgId}/playground/run`;
  const fetchOptions: RequestInit = {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json", Accept: "text/event-stream" },
    body: JSON.stringify(wireBody(request)),
    signal,
  };

  let response = await fetch(url, fetchOptions);
  if (response.status === 401) {
    await attemptTokenRefresh(url);
    response = await fetch(url, fetchOptions);
  }

  // Everything the server can reject before the stream opens arrives as a real
  // status with a message worth showing — an unresolved template variable, a
  // provider that is gone, a model the provider will not serve.
  if (!response.ok) {
    throw new PlaygroundRunError(
      await failureMessage(response),
      response.status === 429 || response.status >= 500,
    );
  }

  const reader = response.body?.getReader();
  if (!reader) throw new PlaygroundRunError("Playground run returned no body", false);

  const decoder = new TextDecoder();
  let buffer = "";
  let text = "";
  let toolCall: PlaygroundRunToolCall | null = null;
  let usage: PlaygroundRunUsage | null = null;

  // Drains until the reader reports done.
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    // SSE frames are separated by a blank line; a partial tail stays buffered.
    const frames = buffer.split("\n\n");
    buffer = frames.pop() ?? "";

    for (const frame of frames) {
      const data = parseFrame(frame);
      if (!data) continue;

      switch (data.type) {
        case "delta": {
          const chunk = String(data.content ?? "");
          if (chunk) {
            text += chunk;
            onDelta(chunk);
          }
          break;
        }
        case "toolCall":
          // The model may emit several; the cell shows one, so the first wins.
          if (!toolCall) {
            toolCall = {
              name: String(data.name ?? ""),
              arguments: String(data.arguments ?? ""),
            };
          }
          break;
        case "done":
          usage = normalizeUsage(data);
          break;
        case "error":
          // Once the stream is open the server has no status code left, so an
          // error frame is the only failure channel. Treat it as retryable:
          // these are provider hiccups mid-call, not rejected requests.
          throw new PlaygroundRunError(
            String(data.error ?? "Playground run failed"),
            true,
          );
        // `rendered` carries the prompt exactly as sent. The bench already
        // renders it locally, so it is accepted and ignored.
        default:
          break;
      }
    }
  }

  return { text, toolCall, usage: usage ?? emptyUsage() };
}

/** The server's error message, falling back to the bare status. */
async function failureMessage(response: Response): Promise<string> {
  try {
    const body = await response.text();
    const parsed = JSON.parse(body) as { message?: unknown; error?: unknown };
    const message = parsed.message ?? parsed.error;
    if (typeof message === "string" && message.trim()) return message;
  } catch {
    // Not JSON, or the body was already consumed — fall through.
  }
  return `Playground run failed with status ${response.status}`;
}

/**
 * Pull the JSON out of one SSE frame.
 *
 * The server sends `data:` lines only and puts the discriminator inside the
 * payload as `type`, so any `event:` line is ignored rather than trusted.
 */
function parseFrame(frame: string): Record<string, unknown> | null {
  const dataLines: string[] = [];
  for (const line of frame.split("\n")) {
    if (line.startsWith("data:")) dataLines.push(line.slice(5).trim());
  }
  if (dataLines.length === 0) return null;

  const payload = dataLines.join("\n");
  if (!payload || payload === "[DONE]") return null;
  try {
    return JSON.parse(payload) as Record<string, unknown>;
  } catch {
    return null;
  }
}

/**
 * Read the `done` frame's accounting.
 *
 * `cost` is null whenever the provider withheld token counts or no pricing is
 * registered for the model, which reads as a zero in the cost strip.
 */
function normalizeUsage(data: Record<string, unknown>): PlaygroundRunUsage {
  const usage = (data.usage ?? {}) as Record<string, unknown>;
  return {
    promptTokens: Number(usage.promptTokens ?? 0),
    completionTokens: Number(usage.completionTokens ?? 0),
    costUsd: Number(usage.cost ?? 0),
    latencyMs: Number(data.latencyMs ?? 0),
  };
}

function emptyUsage(): PlaygroundRunUsage {
  return { promptTokens: 0, completionTokens: 0, costUsd: 0, latencyMs: 0 };
}

// ── mock adapter ──────────────────────────────────────────────────

/** Chunk cadence, in ms. Small enough to look like streaming, large enough that
 *  a test can advance past a whole run in a handful of timer ticks. */
const MOCK_CHUNK_MS = 40;

/** Deterministic 32-bit hash, so the same request always yields the same run. */
function hashRequest(request: PlaygroundRunRequest): number {
  const source = JSON.stringify([
    request.model,
    request.params.temperature ?? 0,
    request.messages.map((message) => `${message.role}:${message.content}`),
    request.responseSchema ? "structured" : "text",
  ]);
  let hash = 2166136261;
  for (let i = 0; i < source.length; i += 1) {
    hash ^= source.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

/** Mulberry32 — a small seeded PRNG, so a seeded run is reproducible. */
function seededRandom(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const MOCK_SENTENCES = [
  "Refunds are available within 30 days of delivery for unopened items.",
  "The policy applies to every region except where local law requires longer.",
  "Shipping costs are refunded only when the return is caused by a defect.",
  "Store credit is issued immediately; card refunds settle in 5–7 business days.",
  "Escalate to a human agent when the order predates the current policy.",
];

function mockBody(request: PlaygroundRunRequest, random: () => number): string {
  if (request.responseSchema) {
    return JSON.stringify(
      {
        answer: MOCK_SENTENCES[Math.floor(random() * MOCK_SENTENCES.length)],
        grounded: random() > 0.25,
        citations: ["policy§2.1"],
      },
      null,
      2,
    );
  }
  const count = 2 + Math.floor(random() * 3);
  const picked: string[] = [];
  for (let i = 0; i < count; i += 1) {
    picked.push(MOCK_SENTENCES[Math.floor(random() * MOCK_SENTENCES.length)]);
  }
  return picked.join(" ");
}

/**
 * Reproduces the three shapes the live endpoint will have: a streamed text
 * completion, a terminal tool call, and a retryable provider failure. Timers
 * are plain `setTimeout`, so a test drives it with fake timers.
 */
export function runPlaygroundMock(
  request: PlaygroundRunRequest,
  { onDelta, signal }: PlaygroundRunOptions,
): Promise<PlaygroundRunResult> {
  return new Promise<PlaygroundRunResult>((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException("Aborted", "AbortError"));
      return;
    }

    const random = seededRandom(hashRequest(request));
    const promptTokens = request.messages.reduce(
      (total, message) => total + Math.ceil(message.content.length / 4),
      0,
    );

    let detachAbort = () => {};
    let timer: ReturnType<typeof setTimeout> | null = null;
    let interval: ReturnType<typeof setInterval> | null = null;

    const stop = () => {
      if (timer !== null) clearTimeout(timer);
      if (interval !== null) clearInterval(interval);
      detachAbort();
    };

    detachAbort = onAbort(signal, () => {
      stop();
      reject(new DOMException("Aborted", "AbortError"));
    });

    // A model given tools calls one instead of answering — same as the live
    // contract, where the call terminates the run.
    const tool = request.tools?.[0];
    if (tool && !request.messages.some((message) => message.role === "tool")) {
      timer = setTimeout(() => {
        stop();
        resolve({
          text: "",
          toolCall: { name: tool.name, arguments: '{ "order_id": "SH202604280912" }' },
          usage: {
            promptTokens,
            completionTokens: 21,
            costUsd: mockCost(promptTokens + 21),
            latencyMs: MOCK_CHUNK_MS * 3,
          },
        });
      }, MOCK_CHUNK_MS * 3);
      return;
    }

    // A stable ~8% of runs fail retryably, so the error path is exercised
    // without a developer having to force it.
    if (random() < 0.08) {
      timer = setTimeout(() => {
        stop();
        reject(new PlaygroundRunError("provider 429 · rate limited after 3 retries", true));
      }, MOCK_CHUNK_MS * 2);
      return;
    }

    const body = mockBody(request, random);
    let emitted = 0;
    let elapsed = 0;

    interval = setInterval(() => {
      const step = 6 + Math.floor(random() * 10);
      const next = Math.min(body.length, emitted + step);
      onDelta(body.slice(emitted, next));
      emitted = next;
      elapsed += MOCK_CHUNK_MS;

      if (emitted >= body.length) {
        stop();
        const completionTokens = Math.ceil(body.length / 4);
        resolve({
          text: body,
          toolCall: null,
          usage: {
            promptTokens,
            completionTokens,
            costUsd: mockCost(promptTokens + completionTokens),
            latencyMs: elapsed,
          },
        });
      }
    }, MOCK_CHUNK_MS);
  });
}

/** A plausible blended per-token price, so the cost strip shows real digits. */
function mockCost(tokens: number): number {
  return Number((tokens * 0.0000025).toFixed(6));
}

/** Wires an abort listener and hands back the detach function, so a settled run
 *  never leaves a listener on a long-lived signal. */
function onAbort(signal: AbortSignal | undefined, handler: () => void): () => void {
  if (!signal) return () => {};
  signal.addEventListener("abort", handler, { once: true });
  return () => signal.removeEventListener("abort", handler);
}
