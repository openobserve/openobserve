import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import http from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";

export const REVIEW_AGENT_PREFIX = "ai-review-";

// REVIEW_OPENCODE_CONFIG picks one of these; anything else fails closed rather than falling back.
export const OPENCODE_CONFIGS = {
  default: { file: "opencode.jsonc", readOnly: true },
  "ci-full": { file: "opencode.ci.jsonc", readOnly: false },
};

// The tools opencode 2.2.0 offers a primary agent when nothing is denied (2.x has no tool-id listing, so this is pinned).
// Each is gated by the permission action of the same name, except write, which shares "edit".
export const BUILTIN_TOOL_IDS = new Set([
  "read", "glob", "grep", "edit", "write", "shell", "webfetch", "websearch",
  "question", "skill", "subagent", "execute",
]);

const ALLOWED_TOOL_IDS = new Set(["read", "glob", "grep"]);
const EDIT_TOOL_IDS = new Set(["edit", "write"]);
// What ci-full must actually grant without asking; a config that fell back to the defaults fails here.
const CI_FULL_TOOL_IDS = ["read", "glob", "grep", "edit", "write", "shell", "webfetch"];

// 2.x dropped OPENCODE_PURE and the plugin, skill and LSP-download flags; sanitizePrTree covers what they did.
const SANDBOX_FLAGS = {
  OPENCODE_DISABLE_PROJECT_CONFIG: "true",
  OPENCODE_CONFIG_PROJECT_DISABLE: "true",
  OPENCODE_DISABLE_CLAUDE_CODE: "true",
  OPENCODE_DISABLE_AUTOUPDATE: "true",
  OPENCODE_DISABLE_MODELS_FETCH: "true",
  OPENCODE_DISABLE_FREE_MODELS: "true",
  OPENCODE_DISABLE_FILEWATCHER: "true",
};

const SYSTEM_ENTRY_KEY = "review-instructions";
const INTERRUPTED_ERROR = { type: "interrupted", message: "opencode interrupted the run" };

const DEFAULT_REQUEST_HEADERS_TIMEOUT_MS = 30_000;
const STATUS_POLL_MS = 15_000;
const STREAM_RETRY_MS = 1_000;
const TRANSIENT_ERROR_RE = /ECONNRESET|ECONNREFUSED|ETIMEDOUT|EPIPE|socket hang up|overloaded|rate limit|too many requests|temporarily unavailable|bad gateway|service unavailable|gateway timeout/i;
// opencode 2.x StructuredError types; the first set is worth a fresh session, the second never is, whatever the message says.
const TRANSIENT_ERROR_TYPES = new Set(["provider.rate-limit", "provider.transport", "provider.timeout", "provider.internal"]);
const PERMANENT_ERROR_TYPES = new Set([
  "provider.auth", "provider.invalid-request", "provider.content-filter", "provider.budget-limit",
  "provider.model-budget-limit", "provider.quota", "provider.free-limit", "provider.unsupported-operation", "interrupted",
]);

export class OpencodeError extends Error {
  constructor(message, { transient = false, permanent = false, name = "OpencodeError", cause } = {}) {
    super(message, cause ? { cause } : undefined);
    this.name = name;
    this.transient = transient;
    // Set when opencode classified the failure (auth, quota, ...): no message pattern may make it retryable.
    this.permanent = permanent;
  }
}

export function resolveOpencodeConfig(name) {
  const key = name || "default";
  const config = OPENCODE_CONFIGS[key];
  if (!config) throw new OpencodeError(`unknown REVIEW_OPENCODE_CONFIG "${key}" (expected ${Object.keys(OPENCODE_CONFIGS).join(" or ")})`);
  return { name: key, ...config };
}

export class OpencodeServer {
  constructor({ binary = process.env.OPENCODE_BIN || "opencode", cwd, configPath, providerKeyVars = [], parentEnv = process.env, startTimeoutMs = 30_000, readOnly = true }) {
    this.binary = binary;
    this.readOnly = readOnly;
    this.cwd = cwd;
    this.configPath = configPath;
    this.providerKeyVars = providerKeyVars;
    this.parentEnv = parentEnv;
    this.startTimeoutMs = startTimeoutMs;
    this.proc = null;
    this.home = "";
    this.client = null;
    this.starting = null;
    this.stderrTail = "";
  }

  async ensureStarted() {
    if (this.client) return this.client;
    if (!this.starting) this.starting = this.start().finally(() => { this.starting = null; });
    return this.starting;
  }

  async start() {
    this.home = mkdtempSync(join(tmpdir(), "ai-review-opencode-"));
    const password = randomBytes(24).toString("hex");
    const env = buildServerEnv({
      parentEnv: this.parentEnv,
      home: this.home,
      configPath: this.configPath,
      password,
      providerKeyVars: this.providerKeyVars,
    });
    for (const dir of [env.XDG_CONFIG_HOME, env.XDG_DATA_HOME, env.XDG_CACHE_HOME, env.XDG_STATE_HOME]) {
      mkdirSync(dir, { recursive: true });
    }

    const proc = spawn(this.binary, ["serve", "--hostname", "127.0.0.1", "--port", "0"], {
      cwd: this.cwd,
      env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    this.proc = proc;
    proc.stderr.on("data", chunk => {
      this.stderrTail = (this.stderrTail + chunk.toString()).slice(-4000);
    });

    const baseUrl = await waitForListening(proc, this.startTimeoutMs, () => this.stderrTail);
    proc.on("exit", () => {
      this.proc = null;
      this.client?.close();
      this.client = null;
    });
    this.client = new OpencodeClient({ baseUrl, password, readOnly: this.readOnly });
    return this.client;
  }

  stop() {
    this.client?.close();
    this.client = null;
    if (this.proc && !this.proc.killed) this.proc.kill("SIGTERM");
    this.proc = null;
    if (this.home) rmSync(this.home, { recursive: true, force: true });
    this.home = "";
  }
}

export class OpencodeClient {
  constructor({ baseUrl, password, username = "opencode", headersTimeoutMs = DEFAULT_REQUEST_HEADERS_TIMEOUT_MS, readOnly = true, statusPollMs = STATUS_POLL_MS }) {
    this.baseUrl = baseUrl;
    this.statusPollMs = statusPollMs;
    this.auth = `Basic ${Buffer.from(`${username}:${password}`).toString("base64")}`;
    this.headersTimeoutMs = headersTimeoutMs;
    this.readOnly = readOnly;
    this.waiters = new Map();
    this.stream = null;
    this.streamReady = null;
    this.closed = false;
    this.rejectedPermissions = 0;
  }

  request(method, path, body) {
    return httpRequest(this.baseUrl, method, path, {
      body,
      auth: this.auth,
      headersTimeoutMs: this.headersTimeoutMs,
    });
  }

  async json(method, path, body) {
    const res = await this.request(method, path, body);
    if (res.status < 200 || res.status >= 300) {
      throw new OpencodeError(`opencode ${method} ${path} failed ${res.status}: ${res.text.slice(0, 500)}`, {
        transient: res.status === 429 || res.status >= 500,
      });
    }
    if (!res.text) return null;
    try {
      return JSON.parse(res.text);
    } catch {
      // 2.x answers unknown routes (every 1.x path) with its web app's HTML and a 200.
      throw new OpencodeError(`opencode ${method} ${path} returned non-JSON (${res.text.slice(0, 80)}); is this opencode 2.x?`);
    }
  }

  ensureEventStream() {
    if (this.streamReady) return this.streamReady;
    this.streamReady = new Promise((resolveReady, rejectReady) => {
      this.stream = openEventStream(this.baseUrl, this.auth, {
        onOpen: resolveReady,
        onEvent: event => this.dispatch(event),
        onClose: err => {
          this.stream = null;
          this.streamReady = null;
          rejectReady(err || new OpencodeError("opencode event stream closed before it opened"));
          if (!this.closed) {
            for (const waiter of this.waiters.values()) waiter.onStreamLost();
          }
        },
        headersTimeoutMs: this.headersTimeoutMs,
      });
    });
    return this.streamReady;
  }

  dispatch(event) {
    const props = event?.data || {};
    if (event?.type === "permission.asked") {
      this.answerPermission(props).catch(() => {});
      return;
    }
    const waiter = props.sessionID ? this.waiters.get(props.sessionID) : null;
    if (!waiter) return;
    if (event.type === "session.execution.succeeded") waiter.onIdle();
    else if (event.type === "session.execution.failed") waiter.onError(props.error);
    else if (event.type === "session.execution.interrupted") waiter.onError(INTERRUPTED_ERROR);
  }

  // Read-only reviews reject every prompt; ci-full allows everything in config, so an ask there is approved once.
  async answerPermission(props) {
    if (this.readOnly) {
      this.rejectedPermissions += 1;
      const waiter = this.waiters.get(props.sessionID);
      if (waiter) waiter.rejectedPermissions += 1;
    }
    await this.json("POST", `/api/session/${encodeURIComponent(props.sessionID)}/permission/${encodeURIComponent(props.id)}/reply`, this.readOnly
      ? { decision: "reject", message: "Review agents run read-only inside the PR checkout." }
      : { decision: "once" });
  }

  // Sends the prompt (2.x admits it and returns at once) and waits on the event stream, so no request ever blocks for the length of an agent run (undici's 300 s headersTimeout killed every long review).
  async prompt({ agent, model, variant, system, text, title, timeoutMs }) {
    await this.ensureEventStream();
    // 2.x binds agent, model and variant to the session; the prompt itself carries only text.
    const session = (await this.json("POST", "/api/session", {
      title,
      agent,
      ...(model?.modelID ? { model: { providerID: model.providerID, id: model.modelID, ...(variant ? { variant } : {}) } } : {}),
    })).data;
    const waiter = new SessionWaiter(this, session.id);
    this.waiters.set(session.id, waiter);
    try {
      // 2.x has no per-prompt system field; an instruction entry lands in the system prompt as <context key="...">.
      if (system) {
        await this.json("PUT", `/api/experimental/session/${session.id}/instructions/entries/${SYSTEM_ENTRY_KEY}`, { value: system });
      }
      // Armed before the POST: the run can fail before the prompt call returns, and nothing would replay it.
      const finished = waiter.wait(timeoutMs);
      await this.json("POST", `/api/session/${session.id}/prompt`, { text });
      const outcome = await finished;
      if (outcome.timedOut) {
        await this.request("POST", `/api/session/${session.id}/interrupt`).catch(() => {});
        throw new OpencodeError(`opencode agent ${agent} timed out after ${timeoutMs}ms`, { name: "TimeoutError" });
      }
      const messages = await this.json("GET", `/api/session/${session.id}/message?type=assistant&order=desc&limit=1`);
      const totals = await this.json("GET", `/api/session/${session.id}`).catch(() => null);
      return finalAssistantResult(messages?.data, totals?.data, outcome.error, waiter.rejectedPermissions);
    } finally {
      waiter.cancel();
      this.waiters.delete(session.id);
      await this.request("DELETE", `/api/session/${session.id}`).catch(() => {});
    }
  }

  close() {
    this.closed = true;
    this.stream?.close();
    this.stream = null;
    for (const waiter of this.waiters.values()) waiter.cancel();
  }
}

class SessionWaiter {
  constructor(client, sessionID) {
    this.client = client;
    this.sessionID = sessionID;
    this.rejectedPermissions = 0;
    this.settle = null;
  }

  wait(timeoutMs) {
    return new Promise(resolvePromise => {
      const timer = setTimeout(() => finish({ timedOut: true }), timeoutMs);
      const poll = setInterval(() => this.pollStatus().catch(() => {}), this.client.statusPollMs);
      const finish = outcome => {
        clearTimeout(timer);
        clearInterval(poll);
        this.settle = null;
        resolvePromise(outcome);
      };
      this.settle = finish;
    });
  }

  onIdle() {
    this.settle?.({ timedOut: false, error: null });
  }

  onError(error) {
    this.settle?.({ timedOut: false, error: error || { type: "unknown", message: "opencode run failed" } });
  }

  onStreamLost() {
    setTimeout(() => {
      if (!this.settle) return;
      this.client.ensureEventStream().catch(() => {});
      this.pollStatus().catch(() => {});
    }, STREAM_RETRY_MS).unref();
  }

  cancel() {
    this.settle?.({ timedOut: false, error: { type: "unknown", message: "opencode server stopped" } });
  }

  // Safety net for a dropped event stream: the session holds one prompt, so its first idle record is the end of that run.
  async pollStatus() {
    if (!this.settle) return;
    const idle = await this.client.json("GET", `/api/session/${this.sessionID}/message?type=idle&order=desc&limit=1`);
    const record = idle?.data?.[0];
    if (!record) return;
    if (record.outcome === "succeeded") this.onIdle();
    else if (record.outcome === "interrupted") this.onError(INTERRUPTED_ERROR);
    else this.onError(record.error);
  }
}

export function buildServerEnv({ parentEnv, home, configPath, password, providerKeyVars = [] }) {
  const env = {
    PATH: parentEnv.PATH || "/usr/local/bin:/usr/bin:/bin",
    HOME: home,
    XDG_CONFIG_HOME: join(home, ".config"),
    XDG_DATA_HOME: join(home, ".local", "share"),
    XDG_CACHE_HOME: join(home, ".cache"),
    XDG_STATE_HOME: join(home, ".local", "state"),
    OPENCODE_CONFIG: configPath,
    OPENCODE_SERVER_PASSWORD: password,
    ...SANDBOX_FLAGS,
  };
  for (const name of providerKeyVars) {
    if (/^[A-Z][A-Z0-9_]{0,63}$/.test(name) && parentEnv[name]) env[name] = parentEnv[name];
  }
  return env;
}

// opencode 2.x evaluates rules last-match-wins; a tool is usable while some rule after its last blanket deny lets a resource through.
export function toolEnabled(toolId, ruleset) {
  const rules = ruleset.filter(r => wildcardMatch(permissionAction(toolId), r.action));
  const lastDeny = rules.findLastIndex(r => r.resource === "*" && r.effect === "deny");
  return lastDeny === -1 || rules.slice(lastDeny + 1).some(r => r.effect !== "deny");
}

// True when the last rule for the tool allows every resource, so it runs without a permission prompt.
export function toolAllowedWithoutAsking(toolId, ruleset) {
  const rule = ruleset.findLast(r => wildcardMatch(permissionAction(toolId), r.action));
  return rule?.resource === "*" && rule.effect === "allow";
}

function permissionAction(toolId) {
  return EDIT_TOOL_IDS.has(toolId) ? "edit" : toolId;
}

export function wildcardMatch(input, pattern) {
  const escaped = pattern
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(/\*/g, ".*")
    .replace(/\?/g, ".");
  return new RegExp(`^${escaped}$`, "s").test(input);
}

// 2.x lists no tool ids, so loaded code is checked at its sources: only built-in plugins, no MCP servers, and the
// plugin behind every tool the config grants must be active. readOnly (the default config) also proves every agent
// is read/glob/grep only; ci-full proves the full grant took effect.
export async function selfCheck(client, expectedAgents, { readOnly = true } = {}) {
  // Agents first: 2.x loads a directory's plugins on its first request, and an empty plugin list proves nothing.
  const agents = (await client.json("GET", "/api/agent"))?.data || [];
  const plugins = (await client.json("GET", "/api/plugin"))?.data || [];
  const foreign = plugins.filter(p => p.source?.type !== "builtin");
  if (foreign.length > 0) {
    throw new OpencodeError(`opencode loaded non-built-in plugins (${foreign.map(p => p.id || p.source?.path || p.source?.target).join(", ")}); refusing to review`);
  }
  const broken = plugins.filter(p => p.state?.status !== "active");
  if (broken.length > 0) throw new OpencodeError(`opencode plugins failed to load: ${broken.map(p => `${p.id}: ${p.state?.error || "unknown"}`).join("; ")}`);
  const active = new Set(plugins.map(p => p.id));
  const missing = (readOnly ? [...ALLOWED_TOOL_IDS] : CI_FULL_TOOL_IDS).filter(id => !active.has(`opencode.tool.${id}`));
  if (missing.length > 0) throw new OpencodeError(`opencode tools did not load: ${missing.join(", ")}`);
  const mcp = (await client.json("GET", "/api/mcp"))?.data || [];
  if (mcp.length > 0) throw new OpencodeError(`opencode loaded MCP servers; refusing to review`);

  const byName = new Map(agents.map(agent => [agent.id, agent]));
  const problems = [];
  for (const name of expectedAgents) {
    const agent = byName.get(name);
    if (!agent) {
      problems.push(`${name}: not registered`);
      continue;
    }
    const ruleset = agent.permissions || [];
    if (readOnly) {
      for (const toolId of BUILTIN_TOOL_IDS) {
        const enabled = toolEnabled(toolId, ruleset);
        if (enabled !== ALLOWED_TOOL_IDS.has(toolId)) problems.push(`${name}: ${toolId} ${enabled ? "allowed" : "denied"}`);
      }
      const problem = externalDirectoryProblem(ruleset);
      if (problem) problems.push(`${name}: ${problem}`);
    } else {
      for (const toolId of CI_FULL_TOOL_IDS) {
        if (!toolAllowedWithoutAsking(toolId, ruleset)) problems.push(`${name}: ${toolId} not fully allowed`);
      }
    }
  }
  if (problems.length > 0) throw new OpencodeError(`opencode permission self-check failed: ${problems.join("; ")}`);
  return { toolIds: [...BUILTIN_TOOL_IDS], agents: expectedAgents.length, plugins: plugins.length };
}

// Rules before the last blanket deny are overridden (last match wins); nothing after it may allow a directory.
export function externalDirectoryProblem(ruleset) {
  const applies = r => wildcardMatch("external_directory", r.action);
  const lastDeny = ruleset.findLastIndex(r => applies(r) && r.resource === "*" && r.effect === "deny");
  if (lastDeny === -1) return "external_directory is not denied";
  const extra = ruleset.slice(lastDeny + 1).filter(r => applies(r) && r.effect !== "deny");
  return extra.length > 0 ? `external_directory allows ${extra.map(r => r.resource).join(", ")}` : "";
}

// A retry must leave room for its own full timeout plus whatever still has to run after it (the coordinator).
export function shouldRetry({ err, attempt, maxRetries, remainingMs, timeoutMs, reserveMs = 0 }) {
  return attempt <= maxRetries && isTransientError(err) && remainingMs > timeoutMs + reserveMs;
}

export function isTransientError(err) {
  if (!err) return false;
  if (err.name === "TimeoutError" || err.permanent) return false;
  if (err.transient) return true;
  return TRANSIENT_ERROR_RE.test(err.message || "");
}

export function extractText(content) {
  return (content || [])
    .filter(p => p.type === "text" && !p.synthetic)
    .map(p => p.text || "")
    .join("\n")
    .trim();
}

// messages is newest-first; totals is the session, whose cost and tokens cover every step of the run.
function finalAssistantResult(messages, totals, streamError, rejectedPermissions) {
  const last = (messages || []).find(m => m?.type === "assistant") || null;
  const error = last?.error || streamError;
  if (error) throw agentError(error);
  if (!last) throw new OpencodeError("opencode finished without an assistant message");
  return {
    info: {
      id: last.id,
      modelID: last.model?.id,
      finish: last.finish,
      cost: totals?.cost ?? last.cost,
      tokens: totals?.tokens ?? last.tokens,
    },
    text: extractText(last.content),
    structured: undefined,
    responseId: last.id || "",
    rejectedPermissions,
  };
}

// Accepts 2.x StructuredError ({ type, message, status }) and the 1.x { name, data } shape.
function agentError(error) {
  const data = error.data || {};
  const message = error.message || data.message || error.type || error.name || JSON.stringify(error).slice(0, 500);
  const status = Number(error.status ?? data.statusCode);
  const kind = error.type || error.name || "unknown";
  const permanent = PERMANENT_ERROR_TYPES.has(kind);
  const transient = !permanent && (TRANSIENT_ERROR_TYPES.has(kind)
    || data.isRetryable === true || status === 429 || status >= 500 || TRANSIENT_ERROR_RE.test(message));
  return new OpencodeError(`opencode agent error (${kind}): ${message}`, { transient, permanent });
}

function waitForListening(proc, timeoutMs, stderrTail) {
  // 2.x prints "server listening on ..."; 1.x prefixed it with "opencode ".
  const pattern = /server listening on (http:\/\/[^\s]+)/;
  return new Promise((resolvePromise, rejectPromise) => {
    let buf = "";
    const onData = chunk => {
      buf = (buf + chunk.toString()).slice(-8000);
      const match = pattern.exec(buf);
      if (match) {
        cleanup();
        resolvePromise(match[1]);
      }
    };
    const onExit = code => {
      cleanup();
      rejectPromise(new OpencodeError(`opencode serve exited early (code ${code}): ${stderrTail()}`));
    };
    const timer = setTimeout(() => {
      cleanup();
      proc.kill("SIGTERM");
      rejectPromise(new OpencodeError(`opencode serve did not start within ${timeoutMs}ms: ${stderrTail()}`));
    }, timeoutMs);
    const cleanup = () => {
      clearTimeout(timer);
      proc.stdout.off("data", onData);
      proc.stderr.off("data", onData);
      proc.off("exit", onExit);
    };
    proc.stdout.on("data", onData);
    proc.stderr.on("data", onData);
    proc.on("exit", onExit);
  });
}

export function httpRequest(baseUrl, method, path, { body, auth, headersTimeoutMs = DEFAULT_REQUEST_HEADERS_TIMEOUT_MS } = {}) {
  const url = new URL(path, baseUrl);
  const payload = body === undefined ? null : Buffer.from(JSON.stringify(body));
  return new Promise((resolvePromise, rejectPromise) => {
    const req = http.request(url, {
      method,
      agent: false,
      headers: {
        ...(auth ? { Authorization: auth } : {}),
        Accept: "application/json",
        ...(payload ? { "Content-Type": "application/json", "Content-Length": payload.length } : {}),
      },
    }, res => {
      clearTimeout(timer);
      const chunks = [];
      res.on("data", chunk => chunks.push(chunk));
      res.on("end", () => resolvePromise({ status: res.statusCode, text: Buffer.concat(chunks).toString("utf-8") }));
      res.on("error", err => rejectPromise(new OpencodeError(`opencode ${method} ${path}: ${err.message}`, { transient: true, cause: err })));
    });
    const timer = setTimeout(() => {
      req.destroy(new OpencodeError(`opencode ${method} ${path}: no response headers within ${headersTimeoutMs}ms`, { name: "HeadersTimeoutError" }));
    }, headersTimeoutMs);
    req.on("error", err => {
      clearTimeout(timer);
      rejectPromise(err instanceof OpencodeError ? err : new OpencodeError(`opencode ${method} ${path}: ${err.message}`, { transient: true, cause: err }));
    });
    if (payload) req.write(payload);
    req.end();
  });
}

export function openEventStream(baseUrl, auth, { onOpen, onEvent, onClose, headersTimeoutMs = DEFAULT_REQUEST_HEADERS_TIMEOUT_MS }) {
  const url = new URL("/api/event", baseUrl);
  let closed = false;
  const parser = createSseParser(onEvent);
  const req = http.request(url, {
    method: "GET",
    agent: false,
    headers: { Authorization: auth, Accept: "text/event-stream" },
  }, res => {
    clearTimeout(timer);
    if (res.statusCode !== 200) {
      res.resume();
      finish(new OpencodeError(`opencode GET /api/event failed ${res.statusCode}`));
      return;
    }
    onOpen();
    res.setEncoding("utf-8");
    res.on("data", chunk => parser(chunk));
    res.on("end", () => finish(null));
    res.on("error", err => finish(err));
  });
  const timer = setTimeout(() => req.destroy(new OpencodeError("opencode GET /api/event: no response headers")), headersTimeoutMs);
  const finish = err => {
    if (closed) return;
    closed = true;
    clearTimeout(timer);
    onClose(err);
  };
  req.on("error", err => finish(err));
  req.end();
  return {
    close() {
      closed = true;
      clearTimeout(timer);
      req.destroy();
    },
  };
}

export function createSseParser(onEvent) {
  let buffer = "";
  return chunk => {
    buffer += chunk.replace(/\r\n/g, "\n");
    let boundary = buffer.indexOf("\n\n");
    while (boundary !== -1) {
      const block = buffer.slice(0, boundary);
      buffer = buffer.slice(boundary + 2);
      const data = block
        .split("\n")
        .filter(line => line.startsWith("data:"))
        .map(line => line.slice(5).replace(/^ /, ""))
        .join("\n");
      if (data) {
        try {
          onEvent(JSON.parse(data));
        } catch {
          // A malformed frame must not take down the stream; the status poll covers anything lost.
        }
      }
      boundary = buffer.indexOf("\n\n");
    }
  };
}
