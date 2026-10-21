import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import http from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";

export const REVIEW_AGENT_PREFIX = "ai-review-";

// Exactly what `GET /experimental/tool/ids` returns for the pinned opencode with our config; anything else means a plugin or tool dir was loaded.
export const BUILTIN_TOOL_IDS = new Set([
  "invalid", "question", "bash", "read", "glob", "grep", "edit", "write", "task",
  "webfetch", "todowrite", "websearch", "skill", "apply_patch",
]);

const ALLOWED_TOOL_IDS = new Set(["read", "glob", "grep"]);
const EDIT_TOOL_IDS = new Set(["edit", "write", "apply_patch"]);
const MCP_READ_TOOL_IDS = new Set(["list_mcp_resources", "list_mcp_resource_templates", "read_mcp_resource"]);

const SANDBOX_FLAGS = {
  OPENCODE_DISABLE_PROJECT_CONFIG: "true",
  OPENCODE_DISABLE_EXTERNAL_SKILLS: "true",
  OPENCODE_DISABLE_CLAUDE_CODE: "true",
  OPENCODE_DISABLE_AUTOUPDATE: "true",
  OPENCODE_DISABLE_MODELS_FETCH: "true",
  OPENCODE_DISABLE_LSP_DOWNLOAD: "true",
  OPENCODE_DISABLE_DEFAULT_PLUGINS: "true",
  OPENCODE_PURE: "true",
};

const DEFAULT_REQUEST_HEADERS_TIMEOUT_MS = 30_000;
const STATUS_POLL_MS = 15_000;
const STREAM_RETRY_MS = 1_000;
const TRANSIENT_ERROR_RE = /ECONNRESET|ECONNREFUSED|ETIMEDOUT|EPIPE|socket hang up|overloaded|rate limit|too many requests|temporarily unavailable|bad gateway|service unavailable|gateway timeout/i;

export class OpencodeError extends Error {
  constructor(message, { transient = false, name = "OpencodeError", cause } = {}) {
    super(message, cause ? { cause } : undefined);
    this.name = name;
    this.transient = transient;
  }
}

export class OpencodeServer {
  constructor({ binary = process.env.OPENCODE_BIN || "opencode", cwd, configPath, providerKeyVars = [], parentEnv = process.env, startTimeoutMs = 30_000 }) {
    this.binary = binary;
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
    this.client = new OpencodeClient({ baseUrl, password });
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
  constructor({ baseUrl, password, username = "opencode", headersTimeoutMs = DEFAULT_REQUEST_HEADERS_TIMEOUT_MS }) {
    this.baseUrl = baseUrl;
    this.auth = `Basic ${Buffer.from(`${username}:${password}`).toString("base64")}`;
    this.headersTimeoutMs = headersTimeoutMs;
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
    return res.text ? JSON.parse(res.text) : null;
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
    const props = event?.properties || {};
    if (event?.type === "permission.asked") {
      this.rejectPermission(props).catch(() => {});
      return;
    }
    const waiter = props.sessionID ? this.waiters.get(props.sessionID) : null;
    if (!waiter) return;
    if (event.type === "session.idle") waiter.onIdle();
    else if (event.type === "session.error") waiter.onError(props.error);
  }

  async rejectPermission(props) {
    this.rejectedPermissions += 1;
    const waiter = this.waiters.get(props.sessionID);
    if (waiter) waiter.rejectedPermissions += 1;
    await this.json("POST", `/permission/${encodeURIComponent(props.id)}/reply`, {
      reply: "reject",
      message: "Review agents run read-only inside the PR checkout.",
    });
  }

  // Sends the prompt with prompt_async and waits on the event stream, so no request ever blocks for the length of an agent run (undici's 300 s headersTimeout killed every long review).
  async prompt({ agent, model, variant, system, text, title, timeoutMs, format }) {
    await this.ensureEventStream();
    const session = await this.json("POST", "/session", { title });
    const waiter = new SessionWaiter(this, session.id);
    this.waiters.set(session.id, waiter);
    // Armed before the POST: a session.error can arrive before prompt_async returns, and nothing would replay it.
    const finished = waiter.wait(timeoutMs);
    try {
      await this.json("POST", `/session/${session.id}/prompt_async`, {
        agent,
        model,
        ...(variant ? { variant } : {}),
        ...(format ? { format } : {}),
        system,
        parts: [{ type: "text", text }],
      });
      const outcome = await finished;
      if (outcome.timedOut) {
        await this.request("POST", `/session/${session.id}/abort`).catch(() => {});
        throw new OpencodeError(`opencode agent ${agent} timed out after ${timeoutMs}ms`, { name: "TimeoutError" });
      }
      const messages = await this.json("GET", `/session/${session.id}/message`);
      return finalAssistantResult(messages, outcome.error, waiter.rejectedPermissions);
    } finally {
      waiter.cancel();
      this.waiters.delete(session.id);
      await this.request("DELETE", `/session/${session.id}`).catch(() => {});
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
      const poll = setInterval(() => this.pollStatus().catch(() => {}), STATUS_POLL_MS);
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
    this.settle?.({ timedOut: false, error: error || { name: "UnknownError" } });
  }

  onStreamLost() {
    setTimeout(() => {
      if (!this.settle) return;
      this.client.ensureEventStream().catch(() => {});
      this.pollStatus().catch(() => {});
    }, STREAM_RETRY_MS).unref();
  }

  cancel() {
    this.settle?.({ timedOut: false, error: { name: "UnknownError", data: { message: "opencode server stopped" } } });
  }

  // Safety net for a dropped event stream: idle only counts once the session is known to have finished an assistant turn.
  async pollStatus() {
    if (!this.settle) return;
    const statuses = await this.client.json("GET", "/session/status");
    const status = statuses?.[this.sessionID];
    if (status && status.type !== "idle") return;
    const messages = await this.client.json("GET", `/session/${this.sessionID}/message`);
    const last = lastAssistant(messages);
    if (last && (last.info.time?.completed || last.info.error)) this.onIdle();
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

// Mirrors opencode's Permission.disabled(): a tool is off when the last rule matching its permission is a "*" deny.
export function toolEnabled(toolId, ruleset) {
  const permission = EDIT_TOOL_IDS.has(toolId) ? "edit" : MCP_READ_TOOL_IDS.has(toolId) ? "read" : toolId;
  const rule = [...ruleset].reverse().find(r => wildcardMatch(permission, r.permission));
  return !(rule?.pattern === "*" && rule.action === "deny");
}

export function wildcardMatch(input, pattern) {
  const escaped = pattern
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(/\*/g, ".*")
    .replace(/\?/g, ".");
  return new RegExp(`^${escaped}$`, "s").test(input);
}

export async function selfCheck(client, expectedAgents) {
  const toolIds = await client.json("GET", "/experimental/tool/ids");
  const unknownTools = toolIds.filter(id => !BUILTIN_TOOL_IDS.has(id));
  if (unknownTools.length > 0) {
    throw new OpencodeError(`opencode loaded non-built-in tools (${unknownTools.join(", ")}); refusing to review`);
  }
  const agents = await client.json("GET", "/agent");
  const byName = new Map(agents.map(agent => [agent.name, agent]));
  const problems = [];
  for (const name of expectedAgents) {
    const agent = byName.get(name);
    if (!agent) {
      problems.push(`${name}: not registered`);
      continue;
    }
    for (const toolId of toolIds) {
      const enabled = toolEnabled(toolId, agent.permission || []);
      if (enabled !== ALLOWED_TOOL_IDS.has(toolId)) problems.push(`${name}: ${toolId} ${enabled ? "allowed" : "denied"}`);
    }
    const problem = externalDirectoryProblem(agent.permission || []);
    if (problem) problems.push(`${name}: ${problem}`);
  }
  if (problems.length > 0) throw new OpencodeError(`opencode permission self-check failed: ${problems.join("; ")}`);
  return { toolIds, agents: expectedAgents.length };
}

// Rules before the last blanket deny are overridden (last match wins); after it only opencode's own truncation dir may be allowed.
export function externalDirectoryProblem(ruleset) {
  const applies = r => wildcardMatch("external_directory", r.permission);
  let lastDeny = -1;
  ruleset.forEach((r, i) => {
    if (applies(r) && r.pattern === "*" && r.action === "deny") lastDeny = i;
  });
  if (lastDeny === -1) return "external_directory is not denied";
  const extra = ruleset.slice(lastDeny + 1).filter(r => applies(r) && r.action !== "deny" && !r.pattern.endsWith("/tool-output/*"));
  return extra.length > 0 ? `external_directory allows ${extra.map(r => r.pattern).join(", ")}` : "";
}

// A retry must leave room for its own full timeout plus whatever still has to run after it (the coordinator).
export function shouldRetry({ err, attempt, maxRetries, remainingMs, timeoutMs, reserveMs = 0 }) {
  return attempt <= maxRetries && isTransientError(err) && remainingMs > timeoutMs + reserveMs;
}

export function isTransientError(err) {
  if (!err) return false;
  if (err.name === "TimeoutError") return false;
  if (err.transient) return true;
  return TRANSIENT_ERROR_RE.test(err.message || "");
}

export function extractText(parts) {
  return (parts || [])
    .filter(p => p.type === "text" && !p.synthetic)
    .map(p => p.text || "")
    .join("\n")
    .trim();
}

function lastAssistant(messages) {
  return [...(messages || [])].reverse().find(m => m?.info?.role === "assistant") || null;
}

function finalAssistantResult(messages, streamError, rejectedPermissions) {
  const last = lastAssistant(messages);
  const error = last?.info?.error || streamError;
  if (error) throw agentError(error);
  if (!last) throw new OpencodeError("opencode finished without an assistant message");
  return {
    info: last.info,
    text: extractText(last.parts),
    structured: last.info.structured,
    responseId: last.info.id || "",
    rejectedPermissions,
  };
}

function agentError(error) {
  const data = error.data || {};
  const message = data.message || error.message || error.name || JSON.stringify(error).slice(0, 500);
  const status = Number(data.statusCode);
  const transient = data.isRetryable === true || status === 429 || status >= 500 || TRANSIENT_ERROR_RE.test(message);
  return new OpencodeError(`opencode agent error (${error.name || "unknown"}): ${message}`, { transient });
}

function waitForListening(proc, timeoutMs, stderrTail) {
  const pattern = /opencode server listening on (http:\/\/[^\s]+)/;
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
  const url = new URL("/event", baseUrl);
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
      finish(new OpencodeError(`opencode GET /event failed ${res.statusCode}`));
      return;
    }
    onOpen();
    res.setEncoding("utf-8");
    res.on("data", chunk => parser(chunk));
    res.on("end", () => finish(null));
    res.on("error", err => finish(err));
  });
  const timer = setTimeout(() => req.destroy(new OpencodeError("opencode GET /event: no response headers")), headersTimeoutMs);
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
