import { execSync, spawn } from "node:child_process";
import { readFileSync, existsSync, writeFileSync, unlinkSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { randomBytes, randomUUID } from "node:crypto";
import { context, SpanStatusCode, trace } from "@opentelemetry/api";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { resourceFromAttributes } from "@opentelemetry/resources";
import { BatchSpanProcessor } from "@opentelemetry/sdk-trace-base";
import { NodeTracerProvider } from "@opentelemetry/sdk-trace-node";
import { ATTR_SERVICE_NAME } from "@opentelemetry/semantic-conventions";

const __dirname = dirname(fileURLToPath(import.meta.url));

// ─── Model provider selection ──────────────────────────────────────────────
// The review runs against a single provider per invocation, chosen via env so the
// same script can be launched once per provider (see .github/workflows/ai-code-review.yml,
// which runs a glm + deepseek matrix for a side-by-side comparison). Everything defaults
// to the original GLM-5.2 (Z.ai) setup, so an invocation with no REVIEW_* env set behaves
// exactly as before.
//
// - REVIEW_PROVIDER_ID / REVIEW_MODEL_ID: opencode provider+model IDs (must match a
//   provider/model registered in opencode.jsonc).
// - REVIEW_MODEL_VARIANT: opencode `variant` on session.prompt (GLM uses "max"; empty ⇒ omit).
// - REVIEW_API_KEY_ENV: name of the env var holding the provider API key (checked for presence).
// - REVIEW_AGENT_PREFIX: opencode agent name prefix; each reviewer is `<prefix>-<key>` and the
//   coordinator is `<prefix>-coordinator`, all registered in opencode.jsonc.
// - REVIEW_LABEL: short human label used in the posted comment header (e.g. "GLM-5.2").
// - REVIEW_MARKER: HTML comment marker that identifies this provider's comment on the PR, so
//   the two providers post/update independent comments and never clobber each other.
const PROVIDER_ID = process.env.REVIEW_PROVIDER_ID || "zai";
const MODEL_ID = process.env.REVIEW_MODEL_ID || "glm-5.2";
const MODEL_VARIANT = process.env.REVIEW_MODEL_VARIANT ?? "max";
const API_KEY_VAR_NAME = process.env.REVIEW_API_KEY_ENV || "GLM_API_KEY";
const AGENT_PREFIX = process.env.REVIEW_AGENT_PREFIX || "ai-review";
const MODEL_LABEL = process.env.REVIEW_LABEL || "GLM-5.2";
const MODEL_SLUG = `${PROVIDER_ID}/${MODEL_ID}`;

function apiKey() {
  return process.env[API_KEY_VAR_NAME];
}

const REVIEW_MARKER = process.env.REVIEW_MARKER || "<!-- ai-code-review -->";

// Every marker any provider leg may post. findExistingReviewComment matches on substring, so a
// comment carrying a foreign marker gets claimed — and overwritten — by that other provider's
// leg. The coordinator prompt is now told not to emit markers at all, but models don't reliably
// obey formatting instructions, so sanitizeReviewBody strips all of these and re-prepends only
// REVIEW_MARKER: exactly one marker per comment, enforced in code rather than by the prompt.
// Keep in sync with the `marker` values in .github/workflows/ai-code-review.yml.
const ALL_REVIEW_MARKERS = [
  "<!-- ai-code-review -->",
  "<!-- ai-code-review-deepseek -->",
];
const MAX_DIFF_TOKENS = 150_000;
const AGENT_TIMEOUT_MS = 5 * 60 * 1000;
const OVERALL_TIMEOUT_MS = 20 * 60 * 1000;
const TRACE_SERVICE_NAME = "github-actions.ai-code-review";
const TRACE_SCOPE_NAME = "scripts/ai-review/run-review.mjs";
const DEFAULT_TRACE_STREAM = "github_ai_code_review";

// ─── Noise patterns ────────────────────────────────────────────────────────
const NOISE_FILES = [
  "bun.lock", "package-lock.json", "yarn.lock", "pnpm-lock.yaml",
  "Cargo.lock", "go.sum", "poetry.lock", "Pipfile.lock", "flake.lock",
  ".gitignore", "deny.toml",
];
const NOISE_EXTENSIONS = [".min.js", ".min.css", ".bundle.js", ".map", ".svg"];
const NOISE_GENERATED_MARKERS = ["@generated", "auto-generated", "DO NOT EDIT", "Generated file"];

// ─── Agent definitions ─────────────────────────────────────────────────────
// Model/agent execution is delegated to `opencode serve` (see OpencodeServer below).
// Each key here maps to an agent of the same name (`ai-review-<key>`) registered in
// opencode.jsonc, all running GLM-5.2 at max reasoning effort with read-only repo tools.
// opencodeAgent names are derived from AGENT_PREFIX so the same definitions drive both the
// GLM (`ai-review-*`) and DeepSeek (`ai-review-deepseek-*`) agent sets in opencode.jsonc.
const AGENTS = {
  security: {
    name: "Security Reviewer",
    promptFile: "agents/security.md",
    opencodeAgent: `${AGENT_PREFIX}-security`,
    fileFocus: f => /\.rs$|\.toml$|auth|authz|oauth|token|crypto|secret|password|unsafe/.test(f),
  },
  "code-quality": {
    name: "Code Quality Reviewer",
    promptFile: "agents/code-quality.md",
    opencodeAgent: `${AGENT_PREFIX}-code-quality`,
    fileFocus: f => /\.rs$|\.ts$|\.vue$|\.js$/.test(f),
  },
  performance: {
    name: "Performance Reviewer",
    promptFile: "agents/performance.md",
    opencodeAgent: `${AGENT_PREFIX}-performance`,
    fileFocus: f => /\.rs$|\.ts$|\.vue$|\.sql$/.test(f),
  },
  documentation: {
    name: "Documentation Reviewer",
    promptFile: "agents/documentation.md",
    opencodeAgent: `${AGENT_PREFIX}-documentation`,
    fileFocus: () => true,
  },
  release: {
    name: "Release Reviewer",
    promptFile: "agents/release.md",
    opencodeAgent: `${AGENT_PREFIX}-release`,
    fileFocus: f => /Cargo\.toml|package\.json|\.sql$|migration|Migration|\.yml$|Dockerfile|docker/.test(f),
  },
};

// ─── Risk tiers ────────────────────────────────────────────────────────────
const COORDINATOR_AGENT = `${AGENT_PREFIX}-coordinator`;
const RISK_TIERS = {
  trivial: {
    maxLines: 10,
    maxFiles: 20,
    agents: ["code-quality"],
    coordinatorAgent: COORDINATOR_AGENT,
  },
  lite: {
    maxLines: 100,
    maxFiles: 20,
    agents: ["code-quality", "documentation"],
    coordinatorAgent: COORDINATOR_AGENT,
  },
  full: {
    agents: ["security", "code-quality", "performance", "documentation", "release"],
    coordinatorAgent: COORDINATOR_AGENT,
  },
};

// ─── Helpers ───────────────────────────────────────────────────────────────

function gh(args) {
  const result = execSync(`gh ${args}`, {
    encoding: "utf-8",
    maxBuffer: 50 * 1024 * 1024,
    stdio: ["pipe", "pipe", "pipe"],
    env: { ...process.env, NO_COLOR: "1", GH_NO_UPDATE_NOTIFIER: "1" },
  });
  return result.trim();
}

function ghJson(args) {
  return JSON.parse(gh(args + " --jq '.'"));
}

function ghSilent(args) {
  try {
    return gh(args);
  } catch {
    return "";
  }
}

function git(args) {
  return execSync(`git ${args}`, {
    encoding: "utf-8",
    maxBuffer: 50 * 1024 * 1024,
    stdio: ["pipe", "pipe", "pipe"],
  }).trim();
}

function execErrorText(err) {
  return [err?.message, err?.stderr?.toString(), err?.stdout?.toString()].filter(Boolean).join(" ");
}

// The API refuses to render a diff over 20k lines (HTTP 406). GitHub still publishes the
// merge commit for the PR, and its first parent is the merge base, so diffing the two
// reproduces the same three-dot diff with no size ceiling.
function diffFromMergeRef(prNumber) {
  git(`fetch --no-tags --depth=2 origin "refs/pull/${prNumber}/merge"`);
  return git("diff FETCH_HEAD^1 FETCH_HEAD");
}

function fetchPrDiff(prNumber) {
  try {
    return gh(`pr diff "${prNumber}"`);
  } catch (err) {
    const detail = execErrorText(err);
    if (!/exceeded the maximum number of lines|HTTP 406/i.test(detail)) throw err;
    console.log(`[${isoNow()}] PR diff is too large for the GitHub API; rebuilding it from the merge ref`);
    return diffFromMergeRef(prNumber);
  }
}

function readPrompt(name) {
  const path = resolve(__dirname, name);
  if (!existsSync(path)) return "";
  return readFileSync(path, "utf-8").trim();
}

function isoNow() {
  return new Date().toISOString();
}

// --- OpenObserve trace export -------------------------------------------------

function randomHex(bytes) {
  return randomBytes(bytes).toString("hex");
}

function workflowTraceId() {
  const traceId = (process.env.O2_TRACE_ID || "").trim().toLowerCase();
  if (/^[0-9a-f]{32}$/.test(traceId) && !/^0+$/.test(traceId)) return traceId;
  return randomHex(16);
}

function cleanAttributeValue(value) {
  if (value === undefined || value === null || value === "") return undefined;
  if (typeof value === "bigint") return value.toString();
  if (Array.isArray(value)) return JSON.stringify(value.filter(v => v !== undefined && v !== null && v !== "")).slice(0, 1024);
  if (typeof value === "object") return JSON.stringify(value).slice(0, 1024);
  return value;
}

function cleanAttributes(attributes = {}) {
  const cleaned = {};
  for (const [key, rawValue] of Object.entries(attributes)) {
    const value = cleanAttributeValue(rawValue);
    if (value !== undefined) cleaned[key] = value;
  }
  return cleaned;
}

function traceEndpoint() {
  const rawUrl = (process.env.O2_TRACE_INGEST_URL || "").trim().replace(/\/+$/, "");
  if (!rawUrl) return "";
  if (/\/api\/[^/]+\/v1\/traces$/.test(rawUrl)) return rawUrl;
  if (/\/api\/[^/]+$/.test(rawUrl)) return `${rawUrl}/v1/traces`;
  const org = encodeURIComponent(process.env.O2_TRACE_ORG || "default");
  return `${rawUrl}/api/${org}/v1/traces`;
}

function traceExportTimeoutMs() {
  const value = Number(process.env.O2_TRACE_EXPORT_TIMEOUT_MS || 60_000);
  return Number.isFinite(value) && value > 0 ? value : 60_000;
}

function traceExportBatchSize() {
  const value = Number(process.env.O2_TRACE_EXPORT_BATCH_SIZE || 1);
  return Number.isInteger(value) && value > 0 ? value : 1;
}

function traceAuthHeader() {
  const auth = (process.env.O2_TRACE_AUTH || "").trim();
  if (auth) return auth.startsWith("Basic ") ? auth : `Basic ${auth}`;

  const username = process.env.O2_TRACE_USERNAME;
  const password = process.env.O2_TRACE_PASSWORD;
  if (!username || !password) return "";
  return `Basic ${Buffer.from(`${username}:${password}`).toString("base64")}`;
}

function formatTraceExportError(error) {
  if (Array.isArray(error)) {
    return error.map(formatTraceExportError).join("; ");
  }
  if (!error) return "unknown error";
  if (typeof error === "string") return error;

  const parts = [];
  if (error.name) parts.push(error.name);
  if (error.message) parts.push(error.message);
  if (error.code !== undefined) parts.push(`code=${error.code}`);
  if (error.data) parts.push(`data=${String(error.data).slice(0, 500)}`);
  if (error.cause) parts.push(`cause=${formatTraceExportError(error.cause)}`);
  return parts.length > 0 ? parts.join(" ") : JSON.stringify(error);
}

function workflowRunUrl() {
  const server = process.env.GITHUB_SERVER_URL || "https://github.com";
  const repo = process.env.GITHUB_REPOSITORY;
  const runId = process.env.GITHUB_RUN_ID;
  if (!repo || !runId) return "";
  return `${server}/${repo}/actions/runs/${runId}`;
}

function traceResourceAttributes() {
  return {
    "service.name": TRACE_SERVICE_NAME,
    "service.version": "1.0.0",
    "telemetry.sdk.language": "javascript",
    "telemetry.sdk.name": "openobserve-ai-review-inline",
    "ci.provider.name": "github-actions",
    "github.repository": process.env.GITHUB_REPOSITORY,
    "github.workflow": process.env.GITHUB_WORKFLOW,
    "github.run_id": process.env.GITHUB_RUN_ID,
    "github.run_number": process.env.GITHUB_RUN_NUMBER,
    "github.run_attempt": process.env.GITHUB_RUN_ATTEMPT,
    "github.job": process.env.GITHUB_JOB,
    "github.actor": process.env.GITHUB_ACTOR,
    "github.event_name": process.env.GITHUB_EVENT_NAME,
    "github.ref": process.env.GITHUB_REF,
    "github.sha": process.env.GITHUB_SHA,
    "github.workflow.run_url": workflowRunUrl(),
  };
}

class SerialTraceExporter {
  constructor(exporter) {
    this.exporter = exporter;
    this.queue = Promise.resolve();
  }

  export(spans, resultCallback) {
    this.queue = this.queue
      .catch(() => {})
      .then(() => new Promise(resolve => {
        try {
          this.exporter.export(spans, result => {
            try {
              resultCallback(result);
            } finally {
              resolve();
            }
          });
        } catch (err) {
          try {
            resultCallback({ code: 1, error: err });
          } finally {
            resolve();
          }
        }
      }));
  }

  async forceFlush() {
    await this.queue.catch(() => {});
    if (typeof this.exporter.forceFlush === "function") {
      await this.exporter.forceFlush();
    }
  }

  async shutdown() {
    await this.queue.catch(() => {});
    if (typeof this.exporter.shutdown === "function") {
      await this.exporter.shutdown();
    }
  }
}

class TraceRecorder {
  constructor() {
    this.traceId = workflowTraceId();
    this.spanCount = 0;
    this.flushed = false;
    this.enabled = false;
    this.provider = null;

    const endpoint = traceEndpoint();
    const authHeader = traceAuthHeader();
    const spanProcessors = [];
    const timeoutMs = traceExportTimeoutMs();

    if (endpoint && authHeader) {
      this.enabled = true;
      const exporter = new OTLPTraceExporter({
        url: endpoint,
        headers: {
          Authorization: authHeader,
          "stream-name": process.env.O2_TRACE_STREAM || DEFAULT_TRACE_STREAM,
        },
        timeoutMillis: timeoutMs,
        concurrencyLimit: 1,
      });
      spanProcessors.push(new BatchSpanProcessor(new SerialTraceExporter(exporter), {
        maxQueueSize: 2048,
        maxExportBatchSize: traceExportBatchSize(),
        scheduledDelayMillis: 1_000,
        exportTimeoutMillis: timeoutMs,
      }));
    } else if (endpoint && !authHeader) {
      console.warn(`[${isoNow()}] Trace export disabled: O2_TRACE_AUTH or O2_TRACE_USERNAME/O2_TRACE_PASSWORD not configured`);
    }

    this.provider = new NodeTracerProvider({
      idGenerator: {
        generateTraceId: () => this.traceId,
        generateSpanId: () => randomHex(8),
      },
      resource: resourceFromAttributes(cleanAttributes({
        ...traceResourceAttributes(),
        [ATTR_SERVICE_NAME]: TRACE_SERVICE_NAME,
        "workflow.trace_id": this.traceId,
      })),
      spanLimits: {
        attributeCountLimit: 512,
        attributeValueLengthLimit: 1_000_000,
      },
      forceFlushTimeoutMillis: timeoutMs,
      spanProcessors,
    });
    this.provider.register();
    this.tracer = this.provider.getTracer(TRACE_SCOPE_NAME, "1.0.0");
  }

  startSpan(name, attributes = {}, parentSpan = null) {
    const parentContext = parentSpan ? trace.setSpan(context.active(), parentSpan) : undefined;
    return this.tracer.startSpan(name, { attributes: cleanAttributes(attributes) }, parentContext);
  }

  setSpanAttributes(span, attributes = {}) {
    if (!span) return;
    span.setAttributes(cleanAttributes(attributes));
  }

  endSpan(span, attributes = {}, error = null) {
    if (!span) return;
    this.setSpanAttributes(span, attributes);
    if (error) {
      const message = (error.message || String(error)).slice(0, 500);
      span.setAttributes(cleanAttributes({
        "error.type": error.name || "Error",
        "error.message": message,
      }));
      span.setStatus({ code: SpanStatusCode.ERROR, message });
    } else {
      span.setStatus({ code: SpanStatusCode.OK });
    }
    span.end();
    this.spanCount += 1;
  }

  async flush() {
    if (this.flushed) return;
    this.flushed = true;
    if (!this.enabled || this.spanCount === 0) {
      return;
    }

    try {
      console.log(`[${isoNow()}] Exporting ${this.spanCount} trace spans to OpenObserve with trace ID ${this.traceId}`);
      await this.provider.forceFlush();
      await this.provider.shutdown();
      console.log(`[${isoNow()}] Exported ${this.spanCount} trace spans to OpenObserve`);
    } catch (err) {
      console.warn(`[${isoNow()}] Trace export failed: ${formatTraceExportError(err)}`);
    }
  }
}

const TRACE = new TraceRecorder();
let activeRootSpan = null;

// ─── Diff filtering ────────────────────────────────────────────────────────

function parseDiffFiles(diff) {
  const files = [];
  const re = /^diff --git a\/(.*?) b\/(.*?)$/gm;
  let match;
  while ((match = re.exec(diff)) !== null) {
    files.push({ oldPath: match[1], newPath: match[2] });
  }
  return files;
}

function isNoiseFile(path) {
  const filename = path.split("/").pop() || "";
  if (NOISE_FILES.includes(filename)) return true;
  if (NOISE_EXTENSIONS.some(ext => filename.endsWith(ext))) return true;
  return false;
}

function isGeneratedFile(diff, filePath) {
  const migrationPatterns = /migration|\.sql$/i;
  if (migrationPatterns.test(filePath)) return false;

  const firstLines = diff.split("\n").slice(0, 10).join("\n");
  return NOISE_GENERATED_MARKERS.some(m => firstLines.includes(m));
}

function isSecuritySensitiveFile(filePath) {
  return /auth|token|secret|crypto|password|oauth|unsafe|acme|cert/i.test(filePath);
}

function filterDiff(diff) {
  const files = parseDiffFiles(diff);
  const filteredFiles = [];
  let totalAdded = 0;
  let totalRemoved = 0;

  for (const f of files) {
    if (isNoiseFile(f.newPath)) continue;
    filteredFiles.push(f);
  }

  const fileSections = diff.split(/^diff --git /gm).filter(Boolean);
  let filteredDiff = "";

  for (const section of fileSections) {
    const headerMatch = section.match(/^a\/(.*?) b\/(.*?)\n/);
    if (!headerMatch) continue;
    const filePath = headerMatch[2];
    if (isNoiseFile(filePath)) continue;

    const lines = section.split("\n");
    for (const line of lines) {
      if (line.startsWith("+") && !line.startsWith("+++")) totalAdded++;
      if (line.startsWith("-") && !line.startsWith("---")) totalRemoved++;
    }

    filteredDiff += "diff --git " + section;
  }

  return { diff: filteredDiff, files: filteredFiles, totalAdded, totalRemoved };
}

// ─── Risk assessment ───────────────────────────────────────────────────────

function assessRiskTier(filteredDiff) {
  const totalLines = filteredDiff.totalAdded + filteredDiff.totalRemoved;
  const fileCount = filteredDiff.files.length;
  const hasSecurityFiles = filteredDiff.files.some(f => isSecuritySensitiveFile(f.newPath));

  if (fileCount > 50 || hasSecurityFiles) return "full";
  if (totalLines <= 10 && fileCount <= 20) return "trivial";
  if (totalLines <= 100 && fileCount <= 20) return "lite";
  return "full";
}

// ─── LLM calls (via `opencode serve`, GLM-5.2 max effort) ─────────────────
//
// Each reviewer/coordinator is a named agent in opencode.jsonc (ai-review-*), running
// read-only against the checked-out repo via OpencodeServer + callOpencode below. Unlike
// a bare chat-completion call, opencode agents can Read/Grep the actual codebase around
// the diff, not just the diff text — that repo context is the main quality lever over the
// old DeepSeek-only approach.

class OpencodeServer {
  constructor() {
    this.proc = null;
    this.baseUrl = "";
    this.starting = null;
  }

  async ensureStarted() {
    if (this.baseUrl) return this.baseUrl;
    if (this.starting) return this.starting;

    this.starting = (async () => {
      if (!apiKey()) throw new Error(`${API_KEY_VAR_NAME} not set`);

      const proc = spawn("opencode", ["serve", "--hostname", "127.0.0.1", "--port", "0"], {
        cwd: resolve(__dirname, "../.."),
        env: { ...process.env },
        stdio: ["ignore", "pipe", "pipe"],
      });
      this.proc = proc;

      let stderrTail = "";
      proc.stderr.on("data", chunk => {
        stderrTail = (stderrTail + chunk.toString()).slice(-4000);
      });

      const urlPattern = /opencode server listening on (http:\/\/[^\s]+)/;
      const url = await new Promise((resolvePromise, rejectPromise) => {
        let buf = "";
        const onData = chunk => {
          buf += chunk.toString();
          const match = urlPattern.exec(buf) || urlPattern.exec(stderrTail);
          if (match) {
            cleanup();
            resolvePromise(match[1]);
          }
        };
        const onExit = code => {
          cleanup();
          rejectPromise(new Error(`opencode serve exited early (code ${code}): ${stderrTail}`));
        };
        const cleanup = () => {
          proc.stdout.off("data", onData);
          proc.stderr.off("data", onData);
          proc.off("exit", onExit);
        };
        proc.stdout.on("data", onData);
        proc.stderr.on("data", onData);
        proc.on("exit", onExit);
        setTimeout(() => {
          cleanup();
          rejectPromise(new Error(`opencode serve did not start within 30s: ${stderrTail}`));
        }, 30_000);
      });

      proc.on("exit", () => {
        this.baseUrl = "";
        this.proc = null;
      });

      this.baseUrl = url;
      return url;
    })();

    try {
      return await this.starting;
    } finally {
      this.starting = null;
    }
  }

  stop() {
    if (this.proc && !this.proc.killed) {
      this.proc.kill("SIGTERM");
    }
    this.proc = null;
    this.baseUrl = "";
  }
}

const OPENCODE = new OpencodeServer();

function extractText(parts) {
  return (parts || [])
    .filter(p => p.type === "text")
    .map(p => p.text || "")
    .join("\n")
    .trim();
}

async function callOpencode(agentName, systemPrompt, userPrompt, timeoutMs = AGENT_TIMEOUT_MS, traceOptions = {}) {
  const llmSpan = TRACE.startSpan("gen_ai.chat", {
    "gen_ai.operation.name": traceOptions.operationName || "chat",
    "gen_ai.system": PROVIDER_ID,
    "gen_ai.request.model": MODEL_ID,
    "gen_ai.request.reasoning_effort": MODEL_VARIANT || "default",
    "ai.agent.key": traceOptions.agentKey,
    "ai.agent.name": traceOptions.agentName,
    "gen_ai.agent.name": traceOptions.agentName,
    "opencode.agent": agentName,
    "timeout.ms": timeoutMs,
  }, traceOptions.parentSpan);

  const truncatedSystem = systemPrompt.slice(0, 100_000);
  const truncatedUser = userPrompt.slice(0, 150_000);

  TRACE.setSpanAttributes(llmSpan, {
    "gen_ai.prompt.system.content_length": truncatedSystem.length,
    "gen_ai.prompt.user.content_length": truncatedUser.length,
  });

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const baseUrl = await OPENCODE.ensureStarted();

    const sessionResp = await fetch(`${baseUrl}/session`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: `ai-review:${traceOptions.agentKey || agentName}` }),
      signal: controller.signal,
    });
    if (!sessionResp.ok) {
      throw new Error(`opencode session.create failed ${sessionResp.status}: ${(await sessionResp.text()).slice(0, 500)}`);
    }
    const session = await sessionResp.json();

    try {
      const messageResp = await fetch(`${baseUrl}/session/${session.id}/message`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          agent: agentName,
          model: { providerID: PROVIDER_ID, modelID: MODEL_ID },
          ...(MODEL_VARIANT ? { variant: MODEL_VARIANT } : {}),
          system: truncatedSystem,
          parts: [{ type: "text", text: truncatedUser }],
        }),
        signal: controller.signal,
      });
      TRACE.setSpanAttributes(llmSpan, { "http.response.status_code": messageResp.status });

      if (!messageResp.ok) {
        const err = await messageResp.text();
        throw new Error(`opencode session.prompt failed ${messageResp.status}: ${err.slice(0, 500)}`);
      }

      const data = await messageResp.json();
      if (data.info?.error) {
        const errInfo = data.info.error;
        const message = errInfo.data?.message || errInfo.name || JSON.stringify(errInfo).slice(0, 500);
        throw new Error(`opencode agent error (${errInfo.name || "unknown"}): ${message}`);
      }

      const text = extractText(data.parts);
      const responseId = data.info?.id || "";

      TRACE.setSpanAttributes(llmSpan, {
        "gen_ai.output.messages": JSON.stringify([{ role: "assistant", content: text }]),
        "gen_ai.completion.0.role": "assistant",
        "gen_ai.completion.0.content": text,
        "gen_ai.completion.0.content_length": text.length,
        "gen_ai.response.id": responseId,
        "gen_ai.response.model": MODEL_ID,
      });
      TRACE.endSpan(llmSpan, {
        "gen_ai.response.id": responseId,
        "gen_ai.response.model": MODEL_ID,
        "gen_ai.response.text_length": text.length,
      });
      return { text, responseId };
    } finally {
      fetch(`${baseUrl}/session/${session.id}`, { method: "DELETE" }).catch(() => {});
    }
  } catch (err) {
    TRACE.endSpan(llmSpan, {}, err);
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

// ─── Finding parser ────────────────────────────────────────────────────────

function parseFindings(xmlText) {
  const findings = [];
  const re = /<finding>([\s\S]*?)<\/finding>/g;
  let match;
  while ((match = re.exec(xmlText)) !== null) {
    const block = match[1];
    const getTag = (tag) => {
      const m = new RegExp(`<${tag}>(.*?)<\\/${tag}>`, "s").exec(block);
      return m ? m[1].trim() : "";
    };
    const finding = {
      category: getTag("category"),
      severity: getTag("severity"),
      file: getTag("file"),
      line: getTag("line"),
      summary: getTag("summary"),
      description: getTag("description"),
      suggestion: getTag("suggestion"),
    };
    if (finding.severity && finding.summary) {
      findings.push(finding);
    }
  }
  return findings;
}

// ─── Run single reviewer ──────────────────────────────────────────────────

async function runReviewer(agentKey, agentDef, diff, prContext, existingReview, parentSpan) {
  const reviewerSpan = TRACE.startSpan("ai_review.reviewer", {
    "review.agent.key": agentKey,
    "review.agent.name": agentDef.name,
    "ai.agent.key": agentKey,
    "ai.agent.name": agentDef.name,
    "gen_ai.agent.name": agentDef.name,
    "gen_ai.system": PROVIDER_ID,
    "gen_ai.request.model": MODEL_ID,
  }, parentSpan);

  if (!apiKey()) {
    console.log(`[${isoNow()}] ${agentDef.name}: SKIPPED — ${API_KEY_VAR_NAME} not set`);
    TRACE.endSpan(reviewerSpan, {
      "review.skipped": true,
      "review.error": `${API_KEY_VAR_NAME} not set`,
    });
    return { agentKey, agentName: agentDef.name, findings: [], rawText: "", error: `${API_KEY_VAR_NAME} not set`, genAIResponseId: "" };
  }

  const systemPrompt = readPrompt("shared-rules.md");
  const agentPrompt = readPrompt(agentDef.promptFile);
  if (!agentPrompt) {
    const err = new Error(`Missing agent prompt: ${agentDef.promptFile}`);
    TRACE.endSpan(reviewerSpan, {}, err);
    throw err;
  }

  let relevantDiff = diff;
  if (agentDef.fileFocus) {
    const sections = diff.split(/^diff --git /gm).filter(Boolean);
    const relevant = sections.filter(s => {
      const m = s.match(/^a\/(.*?) b\/(.*?)\n/);
      return m && agentDef.fileFocus(m[2]);
    });
    if (relevant.length > 0) {
      relevantDiff = relevant.map(s => "diff --git " + s).join("");
    }
  }

  const userPrompt = [
    `<review_task>`,
    `<pr_context>${prContext}</pr_context>`,
    `<diff>${relevantDiff.slice(0, MAX_DIFF_TOKENS)}</diff>`,
    existingReview ? `<previous_review>${existingReview}</previous_review>` : "",
    `</review_task>`,
  ].join("\n");

  const fullSystem = `${systemPrompt}\n\n${agentPrompt}`;

  console.log(`[${isoNow()}] Starting ${agentDef.name} (${MODEL_SLUG}, ${agentDef.opencodeAgent})`);
  const start = Date.now();

  try {
    const completion = await callOpencode(
      agentDef.opencodeAgent,
      fullSystem,
      userPrompt,
      AGENT_TIMEOUT_MS,
      {
        parentSpan: reviewerSpan,
        agentKey,
        agentName: agentDef.name,
        operationName: "code_review",
      },
    );
    const text = completion.text;
    const elapsed = ((Date.now() - start) / 1000).toFixed(1);
    console.log(`[${isoNow()}] ${agentDef.name} completed in ${elapsed}s`);

    const findings = parseFindings(text);
    if (findings.length === 0 && !text.includes("no-issues") && !text.includes("LGTM")) {
      console.log(`[${isoNow()}] ${agentDef.name}: No structured findings found, checking for no-issues marker`);
      console.log(`[${isoNow()}] ${agentDef.name} raw output (first 500 chars): ${text.slice(0, 500)}`);
    } else {
      console.log(`[${isoNow()}] ${agentDef.name}: ${findings.length} findings`);
    }

    TRACE.endSpan(reviewerSpan, {
      "review.elapsed_seconds": Number(elapsed),
      "review.findings": findings.length,
      "review.raw_text_length": text.length,
      "gen_ai.response.id": completion.responseId,
    });
    return { agentKey, agentName: agentDef.name, findings, rawText: text, error: null, genAIResponseId: completion.responseId };
  } catch (err) {
    const elapsed = ((Date.now() - start) / 1000).toFixed(1);
    console.error(`[${isoNow()}] ${agentDef.name} FAILED after ${elapsed}s: ${err.message}`);
    TRACE.endSpan(reviewerSpan, { "review.elapsed_seconds": Number(elapsed) }, err);
    return { agentKey, agentName: agentDef.name, findings: [], rawText: "", error: err.message, genAIResponseId: "" };
  }
}

// ─── Sanitization ──────────────────────────────────────────────────────────

function sanitizeReviewBody(body) {
  if (!body) return "";

  // If body is JSON-wrapped (edge case from bad LLM output), unwrap it
  let cleaned = body;
  if (cleaned.trim().startsWith("{") && cleaned.trim().endsWith("}")) {
    try {
      const parsed = JSON.parse(cleaned);
      if (parsed.body && typeof parsed.body === "string") {
        cleaned = parsed.body;
      }
    } catch {
      // Not valid JSON, leave as-is
    }
  }

  // Unescape common escaped sequences from LLM output
  cleaned = cleaned.replace(/\\n/g, "\n");
  cleaned = cleaned.replace(/\\t/g, "\t");
  cleaned = cleaned.replace(/\\"/g, '"');

  // Remove any XML boundary tags that escaped into the output
  const boundaryTags = ["mr_input", "mr_body", "mr_comments", "mr_details",
    "changed_files", "existing_inline_findings", "previous_review",
    "custom_review_instructions", "review_task", "pr_context", "diff",
    "all_findings", "coordinator_task", "overall_pr_context", "risk_tier",
    "failed_reviewers", "reviewer", "findings", "finding", "no-issues",
    "category", "severity", "file", "line", "summary", "description", "suggestion"];
  const boundaryPattern = new RegExp(`</?(${boundaryTags.join("|")})[^>]*>`, "gi");
  cleaned = cleaned.replace(boundaryPattern, "");

  // Strip EVERY known marker (not just ours) wherever it appears. The coordinator prompt's
  // output template used to hardcode the GLM marker, so a DeepSeek run would carry both and
  // be matched — and overwritten — by the GLM leg's findExistingReviewComment.
  for (const marker of ALL_REVIEW_MARKERS) {
    cleaned = cleaned.split(marker).join("");
  }

  // Drop any preamble the model emitted before the review proper ("Now I have all the
  // context. Let me produce the consolidated review."). Runs after marker stripping so a
  // leading marker can't anchor the search at index 0 and mask the preamble behind it.
  const headingAt = cleaned.search(/^#{1,3}[ \t]*AI Code Review\b/mi);
  if (headingAt > 0) cleaned = cleaned.slice(headingAt);

  // Re-prepend exactly one marker — ours.
  cleaned = `${REVIEW_MARKER}\n${cleaned.trimStart()}`;

  // Tag the review header with the model label so the GLM and DeepSeek comments are
  // visually distinguishable on the PR. Tolerates trailing words ("AI Code Review Summary")
  // and any case; the negative lookahead for "(" keeps re-runs idempotent.
  cleaned = cleaned.replace(
    /^(#{1,3}[ \t]*AI Code Review\b)(?![ \t]*\()([ \t]*[^\n(]*)$/mi,
    `$1 (${MODEL_LABEL})$2`,
  );

  return cleaned.trim();
}

// ─── Coordinator pass ─────────────────────────────────────────────────────

async function runCoordinator(agentResults, prContext, tier, existingReview, parentSpan) {
  const coordinatorPrompt = readPrompt("agents/coordinator.md");
  const sharedRules = readPrompt("shared-rules.md");

  const findingsSections = agentResults
    .filter(r => r.findings.length > 0)
    .map(r => {
      const xml = r.findings.map(f => `  <finding>
    <category>${f.category}</category>
    <severity>${f.severity}</severity>
    <file>${f.file}</file>
    <line>${f.line}</line>
    <summary>${f.summary}</summary>
    <description>${f.description}</description>
    <suggestion>${f.suggestion}</suggestion>
  </finding>`).join("\n");
      return `<reviewer name="${r.agentName}">\n${xml}\n</reviewer>`;
    }).join("\n");

  const failedAgents = agentResults.filter(r => r.error);
  const failedNote = failedAgents.length > 0
    ? `\n<failed_reviewers>${failedAgents.map(r => r.agentName).join(", ")}</failed_reviewers>`
    : "";

  const userPrompt = [
    `<coordinator_task>`,
    `<overall_pr_context>${prContext}</overall_pr_context>`,
    `<risk_tier>${tier}</risk_tier>`,
    `<all_findings>${findingsSections}</all_findings>`,
    failedNote,
    existingReview ? `<previous_review>${existingReview}</previous_review>` : "",
    `</coordinator_task>`,
  ].join("\n");

  const tierConfig = RISK_TIERS[tier] || RISK_TIERS.full;
  const coordinatorAgent = tierConfig.coordinatorAgent || COORDINATOR_AGENT;
  const coordinatorSpan = TRACE.startSpan("ai_review.coordinator", {
    "review.agent.key": "coordinator",
    "review.agent.name": "Coordinator",
    "ai.agent.key": "coordinator",
    "ai.agent.name": "Coordinator",
    "gen_ai.agent.name": "Coordinator",
    "gen_ai.system": PROVIDER_ID,
    "gen_ai.request.model": MODEL_ID,
    "review.risk_tier": tier,
    "review.findings": agentResults.reduce((sum, r) => sum + r.findings.length, 0),
    "review.failed_agents": agentResults.filter(r => r.error).length,
  }, parentSpan);

  console.log(`[${isoNow()}] Running coordinator (${MODEL_SLUG}, ${coordinatorAgent})`);

  try {
    const completion = await callOpencode(coordinatorAgent, `${sharedRules}\n\n${coordinatorPrompt}`, userPrompt, AGENT_TIMEOUT_MS, {
      parentSpan: coordinatorSpan,
      agentKey: "coordinator",
      agentName: "Coordinator",
      operationName: "code_review.coordination",
    });
    TRACE.endSpan(coordinatorSpan, {
      "review.output_length": completion.text.length,
      "gen_ai.response.id": completion.responseId,
    });
    return { text: completion.text, genAIResponseId: completion.responseId };
  } catch (err) {
    console.error(`[${isoNow()}] Coordinator failed: ${err.message}`);
    const fallback = buildFallbackReview(agentResults, tier, failedAgents);
    TRACE.endSpan(coordinatorSpan, {
      "review.fallback": true,
      "review.output_length": fallback.length,
    }, err);
    return { text: fallback, genAIResponseId: "" };
  }
}

function buildFallbackReview(agentResults, tier, failedAgents) {
  const allFindings = agentResults.flatMap(r => r.findings);

  const seen = new Map();
  const deduped = [];
  for (const f of allFindings) {
    const key = `${(f.category || "").toLowerCase()}|${(f.summary || "").toLowerCase().slice(0, 120)}`;
    const existing = seen.get(key);
    if (existing) {
      const severityRank = { critical: 3, warning: 2, suggestion: 1, low: 0 };
      if ((severityRank[f.severity?.toLowerCase()] || 0) > (severityRank[existing.severity?.toLowerCase()] || 0)) {
        existing.severity = f.severity;
        existing.description = f.description || existing.description;
        existing.suggestion = f.suggestion || existing.suggestion;
        existing.file = f.file || existing.file;
        existing.line = f.line || existing.line;
      }
    } else {
      seen.set(key, f);
      deduped.push(f);
    }
  }

  const MAX_FALLBACK_FINDINGS = 15;
  const sorted = deduped
    .sort((a, b) => {
      const rank = { critical: 3, warning: 2, suggestion: 1, low: 0 };
      return (rank[b.severity?.toLowerCase()] || 0) - (rank[a.severity?.toLowerCase()] || 0);
    })
    .slice(0, MAX_FALLBACK_FINDINGS);

  if (sorted.length === 0) {
    return `${REVIEW_MARKER}
## AI Code Review

### Decision: approved

LGTM — No issues found by automated reviewers.

<details>
<summary>Review details</summary>

- Risk tier: ${tier}
${failedAgents.length > 0 ? `- Failed reviewers: ${failedAgents.map(r => r.agentName).join(", ")}` : ""}

</details>`;
  }

  const findingLine = f => {
    const loc = f.file && f.line && f.line !== "0" ? `\`${f.file}:${f.line}\` ` : f.file ? `\`${f.file}\` ` : "";
    const cat = f.category ? `**[${f.category.charAt(0).toUpperCase() + f.category.slice(1)}]** ` : "";
    const fix = f.suggestion ? ` (→ ${f.suggestion})` : "";
    return `- ${loc}${cat}${f.summary}${fix}`;
  };

  const bySeverity = { critical: [], warning: [], suggestion: [] };
  for (const f of sorted) {
    const sev = (f.severity || "suggestion").toLowerCase();
    (bySeverity[sev in bySeverity ? sev : "suggestion"]).push(f);
  }

  const sections = [];
  if (bySeverity.critical.length > 0) {
    sections.push(`#### 🔴 Blockers`, ...bySeverity.critical.map(findingLine), "");
  }
  if (bySeverity.warning.length > 0) {
    sections.push(`#### 🟡 Warnings`, ...bySeverity.warning.map(findingLine), "");
  }
  if (bySeverity.suggestion.length > 0) {
    sections.push(`#### 🔵 Suggestions`, ...bySeverity.suggestion.map(findingLine), "");
  }

  const failureNote = failedAgents.length > 0
    ? `\n> Note: ${failedAgents.map(r => r.agentName).join(", ")} failed to complete. Findings are from available reviewers only.`
    : "";

  const dedupNote = allFindings.length > sorted.length
    ? `\n> Deduplicated: ${allFindings.length} raw findings → ${sorted.length} unique (${allFindings.length - sorted.length} duplicates removed).`
    : "";

  return `${REVIEW_MARKER}
## AI Code Review

### Decision: approved_with_comments

Automated review — ${failedAgents.length > 0 ? "some reviewers failed and " : ""}coordinator consolidation was skipped. Findings below are deduplicated but un-judged.${failureNote}${dedupNote}

**Findings:** 🔴 ${bySeverity.critical.length} blocker · 🟡 ${bySeverity.warning.length} warning · 🔵 ${bySeverity.suggestion.length} suggestion

<details>
<summary>Show findings (${sorted.length})</summary>

${sections.join("\n")}

---

- Risk tier: ${tier}
- Reviewers completed: ${agentResults.filter(r => !r.error).map(r => r.agentName).join(", ") || "none"}
${failedAgents.length > 0 ? `- Failed reviewers: ${failedAgents.map(r => r.agentName).join(", ")}` : ""}

</details>`;
}

// ─── GitHub integration ────────────────────────────────────────────────────

function findExistingReviewComment(prNumber) {
  try {
    const comments = ghJson(`api "repos/${process.env.GITHUB_REPOSITORY}/issues/${prNumber}/comments"`);
    const ourComments = comments.filter(c => c.body?.includes(REVIEW_MARKER));
    return ourComments.length > 0 ? ourComments[ourComments.length - 1] : null;
  } catch {
    return null;
  }
}

function postReviewComment(prNumber, body) {
  const tmpFile = `/tmp/review_comment_${randomUUID()}.txt`;
  writeFileSync(tmpFile, body, "utf-8");
  try {
    gh(`pr comment "${prNumber}" --body-file "${tmpFile}"`);
  } finally {
    try { unlinkSync(tmpFile); } catch {}
  }
}

function updateReviewComment(commentId, body) {
  const payload = JSON.stringify({ body });
  const tmpFile = `/tmp/review_comment_${randomUUID()}.json`;
  writeFileSync(tmpFile, payload);
  try {
    gh(`api "repos/${process.env.GITHUB_REPOSITORY}/issues/comments/${commentId}" --method PATCH --input "${tmpFile}"`);
  } finally {
    try { unlinkSync(tmpFile); } catch {}
  }
}

// ─── Main ──────────────────────────────────────────────────────────────────

async function main() {
  const prNumber = process.env.PR_NUMBER;
  const rootSpan = TRACE.startSpan("github.workflow.ai_code_review", {
    "workflow.trace_id": TRACE.traceId,
    "github.pr.number": prNumber,
    "review.force_full": process.env.FORCE_FULL === "true",
  });
  activeRootSpan = rootSpan;
  let rootError = null;
  let exitCode = 0;
  let outcome = "success";

  try {
    if (!prNumber) {
      console.error("PR_NUMBER environment variable is required");
      throw new Error("PR_NUMBER environment variable is required");
    }

    console.log(`[${isoNow()}] AI Code Review started for PR #${prNumber}`);
    console.log(`[${isoNow()}] Repository: ${process.env.GITHUB_REPOSITORY}`);

    if (!apiKey()) {
      outcome = "misconfigured";
      TRACE.setSpanAttributes(rootSpan, {
        "review.skipped": true,
        "review.skip_reason": "missing_api_key",
      });
      // A missing key is a CI/secrets misconfiguration, not a "nothing to review" case —
      // fail loudly (non-zero exit) instead of warn+return, so review coverage silently
      // dropping to zero can't slip by as a green check. Also post to the PR so it's
      // visible without digging into Actions logs.
      const message = `${API_KEY_VAR_NAME} is not set. AI Code Review (${MODEL_LABEL}) did not run for this PR — this is a CI misconfiguration, not a skip.`;
      console.error(`[${isoNow()}] ${message}`);
      try {
        postReviewComment(prNumber, `${REVIEW_MARKER}\n## AI Code Review (${MODEL_LABEL})\n\n### Decision: error\n\n⚠️ ${message} Please confirm the \`${API_KEY_VAR_NAME}\` secret is provisioned.`);
      } catch (postErr) {
        console.error(`[${isoNow()}] Also failed to post the misconfiguration notice: ${postErr.message}`);
      }
      throw new Error(message);
    }

    console.log(`[${isoNow()}] ${MODEL_SLUG} (via opencode serve): configured`);

    // 1. Get PR diff
    console.log(`[${isoNow()}] Fetching PR diff...`);
    let diff;
    const diffSpan = TRACE.startSpan("github.pr.diff", { "github.pr.number": prNumber }, rootSpan);
    try {
      diff = fetchPrDiff(prNumber);
      const diffStats = diff.split("\n").length;
      TRACE.endSpan(diffSpan, { "diff.raw_lines": diffStats });
      console.log(`[${isoNow()}] Raw diff: ${diffStats} lines`);
    } catch (err) {
      const detail = execErrorText(err);
      console.error(`Failed to fetch PR diff: ${detail}`);
      TRACE.endSpan(diffSpan, {}, err);
      throw new Error(`Failed to fetch PR diff: ${detail}`);
    }

    // 2. Filter diff
    const filterSpan = TRACE.startSpan("ai_review.diff_filter", {}, rootSpan);
    const rawFiles = parseDiffFiles(diff);
    const filtered = filterDiff(diff);
    const changedLines = filtered.totalAdded + filtered.totalRemoved;
    TRACE.endSpan(filterSpan, {
      "diff.changed_lines": changedLines,
      "diff.filtered_files": filtered.files.length,
      "diff.skipped_files": rawFiles.length - filtered.files.length,
    });
    console.log(`[${isoNow()}] Filtered diff: ${changedLines} changed lines across ${filtered.files.length} files`);
    console.log(`[${isoNow()}] Skipped ${rawFiles.length - filtered.files.length} noise files`);

    if (changedLines === 0) {
      console.log("No meaningful changes to review after filtering. Skipping.");
      outcome = "skipped";
      TRACE.setSpanAttributes(rootSpan, {
        "review.skipped": true,
        "review.skip_reason": "no_meaningful_changes",
      });
      return;
    }

    // 3. Assess risk tier
    const riskSpan = TRACE.startSpan("ai_review.risk_assessment", {
      "review.force_full": process.env.FORCE_FULL === "true",
    }, rootSpan);
    const tier = process.env.FORCE_FULL === "true" ? "full" : assessRiskTier(filtered);
    const tierConfig = RISK_TIERS[tier] || RISK_TIERS.full;
    TRACE.endSpan(riskSpan, {
      "review.risk_tier": tier,
      "review.agent_count": tierConfig.agents.length,
      "review.agents": tierConfig.agents,
    });
    TRACE.setSpanAttributes(rootSpan, {
      "review.risk_tier": tier,
      "review.agent_count": tierConfig.agents.length,
      "review.agents": tierConfig.agents,
      "diff.changed_lines": changedLines,
      "diff.filtered_files": filtered.files.length,
    });
    console.log(`[${isoNow()}] Risk tier: ${tier} → agents: [${tierConfig.agents.join(", ")}]`);

    // 4. PR context
    let prContext = `PR #${prNumber} in ${process.env.GITHUB_REPOSITORY}`;
    const contextSpan = TRACE.startSpan("github.pr.context", { "github.pr.number": prNumber }, rootSpan);
    try {
      const prData = ghJson(`pr view "${prNumber}" --json title,body,author,files`);
      prContext = [
        `Repository: ${process.env.GITHUB_REPOSITORY}`,
        `PR: #${prNumber}`,
        `Title: ${prData.title}`,
        `Author: ${prData.author?.login || "unknown"}`,
        `Files changed: ${prData.files?.length || filtered.files.length}`,
        `Description: ${prData.body || "N/A"}`,
      ].join("\n");
      TRACE.endSpan(contextSpan, {
        "github.pr.author": prData.author?.login || "unknown",
        "github.pr.file_count": prData.files?.length || filtered.files.length,
        "github.pr.body_present": Boolean(prData.body),
      });
    } catch (err) {
      TRACE.endSpan(contextSpan, { "github.pr.context_fallback": true }, err);
    }

    // 5. Check for existing review (re-review mode)
    let existingReview = null;
    let existingCommentId = null;
    const existingSpan = TRACE.startSpan("github.pr.existing_review_lookup", { "github.pr.number": prNumber }, rootSpan);
    const existingComment = findExistingReviewComment(prNumber);
    TRACE.endSpan(existingSpan, {
      "github.pr.existing_review_found": Boolean(existingComment),
      "github.pr.existing_review_comment_id": existingComment?.id,
    });
    if (existingComment) {
      existingCommentId = existingComment.id;
      existingReview = existingComment.body;
      console.log(`[${isoNow()}] Re-review mode: found existing review comment #${existingCommentId}`);
    }

    // 6. Run reviewers in parallel
    const agentsToRun = tierConfig.agents;
    console.log(`[${isoNow()}] Launching ${agentsToRun.length} reviewers in parallel...`);

    const agentResults = await Promise.allSettled(
      agentsToRun.map(agentKey => {
        const def = AGENTS[agentKey];
        if (!def) return Promise.resolve({ agentKey, agentName: agentKey, findings: [], error: `Unknown agent: ${agentKey}`, genAIResponseId: "" });
        return runReviewer(agentKey, def, filtered.diff, prContext, existingReview, rootSpan);
      }),
    );

    const results = agentResults.map(r => r.status === "fulfilled" ? r.value : { agentKey: "unknown", agentName: "unknown", findings: [], error: r.reason?.message || "Unknown error", genAIResponseId: "" });
    const totalFindings = results.reduce((sum, r) => sum + r.findings.length, 0);
    const failedAgents = results.filter(r => r.error);
    const reviewerResponseIds = results.map(r => r.genAIResponseId).filter(Boolean);
    TRACE.setSpanAttributes(rootSpan, {
      "review.total_findings": totalFindings,
      "review.failed_agents": failedAgents.length,
      "review.completed_agents": results.filter(r => !r.error).map(r => r.agentName),
    });
    console.log(`[${isoNow()}] All reviewers complete. Total findings: ${totalFindings}, Failures: ${failedAgents.length}`);

    // 7. Coordinator pass
    const coordinatorResult = await runCoordinator(results, prContext, tier, existingReview, rootSpan);
    let finalReview = coordinatorResult.text;
    const responseIds = [...reviewerResponseIds, coordinatorResult.genAIResponseId].filter(Boolean);
    TRACE.setSpanAttributes(rootSpan, {
      "gen_ai.response.ids": responseIds,
      "gen_ai.response.count": responseIds.length,
    });

    // Sanitize and validate before posting
    const sanitizeSpan = TRACE.startSpan("ai_review.sanitize", {}, rootSpan);
    finalReview = sanitizeReviewBody(finalReview);
    TRACE.endSpan(sanitizeSpan, { "review.final_length": finalReview.length });
    console.log(`[${isoNow()}] Final review length: ${finalReview.length} chars`);

    // 8. Post or update review
    const commentAction = existingCommentId ? "update" : "create";
    const commentSpan = TRACE.startSpan("github.pr.review_comment", {
      "github.pr.comment.action": commentAction,
      "github.pr.number": prNumber,
    }, rootSpan);
    try {
      if (existingCommentId) {
        console.log(`[${isoNow()}] Updating existing review comment #${existingCommentId}`);
        updateReviewComment(existingCommentId, finalReview);
      } else {
        console.log(`[${isoNow()}] Posting new review comment`);
        postReviewComment(prNumber, finalReview);
      }
      TRACE.endSpan(commentSpan, {
        "github.pr.comment.action": commentAction,
        "github.pr.comment.id": existingCommentId,
      });
    } catch (err) {
      TRACE.endSpan(commentSpan, {}, err);
      throw err;
    }

    console.log(`[${isoNow()}] AI Code Review complete for PR #${prNumber}`);
  } catch (err) {
    rootError = err;
    exitCode = 1;
    if (outcome !== "misconfigured") outcome = "failure";
    throw err;
  } finally {
    TRACE.endSpan(rootSpan, {
      "workflow.outcome": outcome,
      "process.exit_code": exitCode,
    }, rootError);
    activeRootSpan = null;
    OPENCODE.stop();
  }
}

// ─── Entry point ───────────────────────────────────────────────────────────

const startTime = Date.now();
const timeout = setTimeout(() => {
  const err = new Error(`Overall timeout (${OVERALL_TIMEOUT_MS / 1000}s) reached`);
  console.error(`[${isoNow()}] ${err.message}. Exiting.`);
  TRACE.endSpan(activeRootSpan, {
    "workflow.outcome": "timeout",
    "process.exit_code": 1,
  }, err);
  OPENCODE.stop();
  TRACE.flush().finally(() => process.exit(1));
}, OVERALL_TIMEOUT_MS);

main()
  .then(async () => {
    clearTimeout(timeout);
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log(`[${isoNow()}] Total execution time: ${elapsed}s`);
    await TRACE.flush();
  })
  .catch(async err => {
    clearTimeout(timeout);
    if (!err.suppressFatalLog) console.error(`[${isoNow()}] Fatal error:`, err);
    process.exitCode = 1;
    await TRACE.flush();
  });
