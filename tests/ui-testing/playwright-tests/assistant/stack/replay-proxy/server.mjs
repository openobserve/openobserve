// Copyright 2026 OpenObserve Inc.
// Replay LLM proxy: an OpenAI-compatible endpoint for o2-ai's gateway URL that answers from hand-written recordings per scenario tag.
import { createServer } from "node:http";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));

export const DEFAULT_SCENARIO = "complete";
const MAX_BODY_BYTES = 8 * 1024 * 1024;
const MAX_SERVED_LOG = 500;
const CHUNK_CHARS = 48;
// Namespaced so page context, link text or tool hints after the prompt can never pick a scenario.
const TAG = /\[replay:([a-z0-9_]{1,40})\]/;
const NAME = /^[a-z0-9_]{1,40}$/;

/** Reads and validates every `recordings/*.json`; a malformed file fails the start, not a turn. */
export function loadRecordings(dir = join(here, "recordings")) {
  const recordings = new Map();
  for (const file of readdirSync(dir).filter((f) => f.endsWith(".json")).sort()) {
    const recording = validateRecording(JSON.parse(readFileSync(join(dir, file), "utf8")), file);
    recordings.set(recording.scenario, recording);
  }
  if (!recordings.has(DEFAULT_SCENARIO)) throw new Error(`replay proxy: no "${DEFAULT_SCENARIO}" recording`);
  return recordings;
}

function validateRecording(raw, file) {
  const fail = (why) => {
    throw new Error(`replay proxy: ${file}: ${why}`);
  };
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) fail("not an object");
  if (raw.version !== 1) fail("version must be 1");
  if (typeof raw.scenario !== "string" || !NAME.test(raw.scenario)) fail("scenario must match [a-z0-9_]{1,40}");
  if (`${raw.scenario}.json` !== file) fail("file name must be <scenario>.json");
  if (!Array.isArray(raw.steps) || raw.steps.length === 0 || raw.steps.length > 20) fail("steps must hold 1 to 20 entries");
  const steps = raw.steps.map((step, i) => {
    if (!step || typeof step !== "object") fail(`step ${i} is not an object`);
    const content = step.content ?? "";
    if (typeof content !== "string") fail(`step ${i} content must be a string`);
    const toolCalls = (step.tool_calls ?? []).map((call, j) => {
      if (typeof call?.name !== "string" || !call.name) fail(`step ${i} tool call ${j} needs a name`);
      return { name: call.name, arguments: JSON.stringify(call.arguments ?? {}) };
    });
    if (!content && toolCalls.length === 0) fail(`step ${i} needs content or tool_calls`);
    return { content, toolCalls };
  });
  return { scenario: raw.scenario, steps };
}

const textOf = (content) =>
  typeof content === "string" ? content : Array.isArray(content) ? content.map((p) => (typeof p?.text === "string" ? p.text : "")).join("") : "";

/** The scenario named by the first `[replay:<name>]` in the latest user message, and how many tool rounds the turn has had since. */
export function selectStep(messages, recordings) {
  const list = Array.isArray(messages) ? messages : [];
  let lastUser = -1;
  for (let i = list.length - 1; i >= 0; i--) {
    if (list[i]?.role === "user") {
      lastUser = i;
      break;
    }
  }
  const tag = lastUser < 0 ? null : TAG.exec(textOf(list[lastUser].content));
  const scenario = tag ? tag[1] : DEFAULT_SCENARIO;
  const recording = recordings.get(scenario);
  if (!recording) return { scenario, error: `no recording for scenario "${scenario}"` };
  const rounds = list.slice(lastUser + 1).filter((m) => m?.role === "assistant").length;
  const index = Math.min(rounds, recording.steps.length - 1);
  return { scenario, index, step: recording.steps[index] };
}

function completionId(scenario, index) {
  return `chatcmpl-replay-${scenario}-${index}`;
}

function usage(step) {
  const completion = Math.max(1, Math.ceil(step.content.length / 4));
  return { prompt_tokens: 1, completion_tokens: completion, total_tokens: completion + 1 };
}

function toolCalls(step, scenario, index) {
  return step.toolCalls.map((call, i) => ({
    id: `call_${scenario}_${index}_${i}`,
    type: "function",
    function: { name: call.name, arguments: call.arguments },
  }));
}

export function completionBody(model, scenario, index, step) {
  const calls = toolCalls(step, scenario, index);
  return {
    id: completionId(scenario, index),
    object: "chat.completion",
    created: 0,
    model,
    choices: [
      {
        index: 0,
        message: { role: "assistant", content: step.content || null, ...(calls.length && { tool_calls: calls }) },
        finish_reason: calls.length ? "tool_calls" : "stop",
      },
    ],
    usage: usage(step),
  };
}

export function completionChunks(model, scenario, index, step, includeUsage) {
  const base = { id: completionId(scenario, index), object: "chat.completion.chunk", created: 0, model };
  const chunk = (delta, finish = null) => ({ ...base, choices: [{ index: 0, delta, finish_reason: finish }] });
  const out = [chunk({ role: "assistant", content: "" })];
  for (let i = 0; i < step.content.length; i += CHUNK_CHARS) out.push(chunk({ content: step.content.slice(i, i + CHUNK_CHARS) }));
  const calls = toolCalls(step, scenario, index);
  calls.forEach((call, i) => out.push(chunk({ tool_calls: [{ index: i, ...call }] })));
  out.push(chunk({}, calls.length ? "tool_calls" : "stop"));
  if (includeUsage) out.push({ ...base, choices: [], usage: usage(step) });
  return out;
}

function sendJson(res, status, body) {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const parts = [];
    let size = 0;
    req.on("data", (part) => {
      size += part.length;
      if (size > MAX_BODY_BYTES) {
        reject(new Error("request body too large"));
        req.destroy();
      } else parts.push(part);
    });
    req.on("end", () => resolve(Buffer.concat(parts).toString("utf8")));
    req.on("error", reject);
  });
}

/** Builds the proxy; `served` keeps scenario and step per answer (never message text) for the run report. */
export function createReplayProxy(recordings = loadRecordings()) {
  const served = [];
  const server = createServer(async (req, res) => {
    const path = (req.url || "").split("?")[0].replace(/\/+$/, "");
    try {
      if (req.method === "GET" && path === "/v1/models") {
        return sendJson(res, 200, { object: "list", data: [{ id: "replay", object: "model", owned_by: "replay" }] });
      }
      if (req.method === "GET" && path === "/__replay/served") return sendJson(res, 200, served);
      if (req.method !== "POST" || path !== "/v1/chat/completions") {
        return sendJson(res, 404, { error: { message: `replay proxy: no route ${req.method} ${path}`, type: "not_found" } });
      }
      const body = JSON.parse(await readBody(req));
      const picked = selectStep(body?.messages, recordings);
      if (picked.error) return sendJson(res, 404, { error: { message: `replay proxy: ${picked.error}`, type: "not_found" } });
      if (served.length >= MAX_SERVED_LOG) served.shift();
      served.push({ scenario: picked.scenario, step: picked.index, stream: !!body?.stream });
      const model = typeof body?.model === "string" ? body.model.slice(0, 120) : "replay";
      if (!body?.stream) return sendJson(res, 200, completionBody(model, picked.scenario, picked.index, picked.step));
      res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache", connection: "keep-alive" });
      const includeUsage = !!body?.stream_options?.include_usage;
      for (const chunk of completionChunks(model, picked.scenario, picked.index, picked.step, includeUsage)) {
        res.write(`data: ${JSON.stringify(chunk)}\n\n`);
      }
      res.end("data: [DONE]\n\n");
    } catch (e) {
      if (!res.headersSent) sendJson(res, 400, { error: { message: `replay proxy: ${e.message}`, type: "invalid_request_error" } });
      else res.end();
    }
  });
  return { server, served };
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) {
  const port = Number(process.env.REPLAY_PROXY_PORT || 5199);
  const host = process.env.REPLAY_PROXY_HOST || "127.0.0.1";
  const { server } = createReplayProxy();
  server.listen(port, host, () => console.log(`replay proxy on http://${host}:${port}/v1`));
}
