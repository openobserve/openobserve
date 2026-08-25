// Copyright 2026 OpenObserve Inc.
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.

/**
 * Playground run contract.
 *
 * `POST /api/{org}/playground/run` does not exist yet. This module owns the
 * shape we are asking backend for AND a deterministic mock adapter, so the UI
 * can be built and tested against the real code path today. Flip
 * `PLAYGROUND_USE_MOCK` when the route ships — nothing upstream changes.
 */

import store from "@/stores";
import { attemptTokenRefresh } from "@/services/http";

/** Flip to `false` once `POST /api/{org}/playground/run` is live. */
export const PLAYGROUND_USE_MOCK = true;

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
  model: string;
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
  return PLAYGROUND_USE_MOCK ? runMock(request, options) : runLive(orgId, request, options);
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
    body: JSON.stringify(request),
    signal,
  };

  let response = await fetch(url, fetchOptions);
  if (response.status === 401) {
    await attemptTokenRefresh(url);
    response = await fetch(url, fetchOptions);
  }
  if (!response.ok) {
    throw new PlaygroundRunError(
      `Playground run failed with status ${response.status}`,
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
      const parsed = parseFrame(frame);
      if (!parsed) continue;
      if (parsed.event === "delta" && typeof parsed.data.text === "string") {
        text += parsed.data.text;
        onDelta(parsed.data.text);
      } else if (parsed.event === "tool") {
        toolCall = {
          name: String(parsed.data.name ?? ""),
          arguments: String(parsed.data.arguments ?? ""),
        };
      } else if (parsed.event === "usage") {
        usage = normalizeUsage(parsed.data);
      } else if (parsed.event === "error") {
        throw new PlaygroundRunError(
          String(parsed.data.message ?? "Playground run failed"),
          parsed.data.retryable === true,
        );
      }
    }
  }

  return { text, toolCall, usage: usage ?? emptyUsage() };
}

function parseFrame(frame: string): { event: string; data: Record<string, unknown> } | null {
  let event = "message";
  const dataLines: string[] = [];
  for (const line of frame.split("\n")) {
    if (line.startsWith("event:")) event = line.slice(6).trim();
    else if (line.startsWith("data:")) dataLines.push(line.slice(5).trim());
  }
  if (dataLines.length === 0) return null;
  try {
    return { event, data: JSON.parse(dataLines.join("\n")) as Record<string, unknown> };
  } catch {
    return null;
  }
}

function normalizeUsage(data: Record<string, unknown>): PlaygroundRunUsage {
  return {
    promptTokens: Number(data.promptTokens ?? data.prompt_tokens ?? 0),
    completionTokens: Number(data.completionTokens ?? data.completion_tokens ?? 0),
    costUsd: Number(data.costUsd ?? data.cost_usd ?? 0),
    latencyMs: Number(data.latencyMs ?? data.latency_ms ?? 0),
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
function runMock(
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
