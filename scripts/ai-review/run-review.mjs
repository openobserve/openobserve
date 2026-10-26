import { execSync } from "node:child_process";
import { readFileSync, existsSync, writeFileSync, unlinkSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { randomBytes, randomUUID } from "node:crypto";
import { context, SpanKind, SpanStatusCode, trace } from "@opentelemetry/api";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { resourceFromAttributes } from "@opentelemetry/resources";
import { BatchSpanProcessor } from "@opentelemetry/sdk-trace-base";
import { NodeTracerProvider } from "@opentelemetry/sdk-trace-node";
import { ATTR_SERVICE_NAME } from "@opentelemetry/semantic-conventions";
import {
  cleanAttributes,
  genAiRequestAttributes,
  genAiResponseAttributes,
  sha256,
} from "./telemetry.mjs";
import { selectOwnReviewComment } from "./src/comments.mjs";
import { OpencodeServer, selfCheck, shouldRetry } from "./src/opencode.mjs";
import { fetchDiff, prefixDiffPaths } from "./src/pr-diff.mjs";
import { sanitizePrTree } from "./src/sanitize.mjs";
import { scrubReviewBody } from "./src/scrub.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));

// ENGINE_DIR is the trusted base-branch checkout; PR_DIR is the PR head, which is data only and never executed.
const ENGINE_DIR = resolve(process.env.ENGINE_DIR || resolve(__dirname, "../.."));
const PR_DIR = process.env.PR_DIR ? resolve(process.env.PR_DIR) : "";
const OPENCODE_CONFIG_PATH = resolve(ENGINE_DIR, "opencode.jsonc");
// A same-named PR in another repo reviewed together with this one (the OSS side of an ENT pair).
const PAIRED = {
  repo: process.env.PAIRED_REPO || "",
  prNumber: process.env.PAIRED_PR_NUMBER || "",
  dir: process.env.PAIRED_DIR || "",
  mergeBase: process.env.PAIRED_MERGE_BASE_SHA || "",
  head: process.env.PAIRED_HEAD_SHA || "",
};

// ─── Model provider selection ──────────────────────────────────────────────
// The review runs against a single provider per invocation, chosen via env so the same script
// can be launched once per provider (see .github/workflows/ai-code-review.yml, whose matrix
// currently has a single deepseek leg). Everything defaults to that DeepSeek-V4-Pro setup, so an
// invocation with no REVIEW_* env set still works. The model is named freely here and in CI logs;
// what must never name it is the posted PR comment — see redactProviderIdentity.
//
// - REVIEW_PROVIDER_ID / REVIEW_MODEL_ID: opencode provider+model IDs (must match a
//   provider/model registered in opencode.jsonc).
// - REVIEW_MODEL_VARIANT: opencode `variant` on session.prompt (empty ⇒ omit).
// - REVIEW_API_KEY_ENV: name of the env var holding the provider API key (checked for presence).
// - REVIEW_MARKER: HTML comment marker that identifies this provider's comment on the PR, so
//   providers post/update independent comments and never clobber each other.
const PROVIDER_ID = process.env.REVIEW_PROVIDER_ID || "deepseek-review";
const MODEL_ID = process.env.REVIEW_MODEL_ID || "deepseek-v4-pro";
const MODEL_VARIANT = process.env.REVIEW_MODEL_VARIANT ?? "";
const GEN_AI_PROVIDER_NAME = process.env.REVIEW_GEN_AI_PROVIDER_NAME
  || (PROVIDER_ID.toLowerCase().includes("deepseek") ? "deepseek" : PROVIDER_ID);
// REVIEW_API_KEY_ENV holds the NAME of the env var carrying the key (e.g. "DEEPSEEK_API_KEY"),
// never the key itself — the value is read only via apiKey() below and is never logged or
// posted. Constrain it to an env-var-shaped token anyway: the name is echoed into CI logs, so a
// malformed value must not become the vehicle for leaking anything. This also keeps CodeQL's
// js/clear-text-logging taint analysis from treating the *name* as the secret (it flags any
// `...API_KEY...` env read reaching a log).
const RAW_API_KEY_VAR_NAME = process.env.REVIEW_API_KEY_ENV || "DEEPSEEK_API_KEY";
const API_KEY_VAR_NAME = /^[A-Z][A-Z0-9_]{0,63}$/.test(RAW_API_KEY_VAR_NAME)
  ? RAW_API_KEY_VAR_NAME
  : "DEEPSEEK_API_KEY";
const MODEL_SLUG = `${PROVIDER_ID}/${MODEL_ID}`;

function apiKey() {
  return process.env[API_KEY_VAR_NAME];
}

const REVIEW_MARKER = process.env.REVIEW_MARKER || "<!-- ai-code-review -->";

// The shape of any marker a provider leg may post — matched as a pattern rather than a list so a
// retired leg's suffixed marker (e.g. the old per-provider ones) is still claimed and rewritten
// in place. The coordinator prompt is told not to emit markers at all, but models don't reliably
// obey formatting instructions, so sanitizeReviewBody strips every match and re-prepends only
// REVIEW_MARKER: exactly one marker per comment, enforced in code rather than by the prompt.
// findExistingReviewComment matches the same pattern. Keep in sync with the `marker` values in
// .github/workflows/ai-code-review.yml.
const ANY_REVIEW_MARKER = "<!--\\s*ai-code-review[a-z0-9-]*\\s*-->";
// Tags the "reviewed with the paired o2-enterprise PR" note (post-paired-pointer.sh); it is replaced in place but is not a previous review.
const PAIRED_POINTER_TAG = "<!-- o2-paired-pointer -->";
// Tags the "not reviewed: key not set" notice, which is likewise replaced but never fed back as a previous review.
const NOTICE_TAG = "<!-- o2-review-notice -->";
// Login of the token that posts the review; anyone else's comment carrying the marker must never become <previous_review>.
const REVIEW_BOT_LOGIN = process.env.REVIEW_BOT_LOGIN || "";

// ─── Branding (presentation only) ───────────────────────────────────────────
// The posted comment is branded "OpenObserve Code Review". These strings change ONLY how the
// comment looks/reads — never what the reviewers find or decide. The engine is unchanged.
const REVIEW_TITLE = "OpenObserve Code Review";
const REVIEW_HEADING = `## 🔎 ${REVIEW_TITLE}`;
// Matches the review heading line whether or not the model included the 🔎 emoji, and tolerates
// a legacy "AI Code Review" heading (older comments / prompt drift) so re-review still finds and
// normalizes the header. Case-insensitive, multiline.
const REVIEW_HEADING_RE = /^#{1,3}[ \t]*(?:🔎[ \t]*)?(?:OpenObserve Code Review|AI Code Review)\b/mi;
// Category → glyph, used by the deterministic fallback renderer to prefix each finding line so it
// matches the coordinator's happy-path formatting. Cosmetic only.
const CATEGORY_GLYPH = {
  security: "🔒",
  performance: "⚡",
  "code-quality": "🧩", "code quality": "🧩", quality: "🧩",
  documentation: "📝", docs: "📝",
  release: "📦",
  frontend: "🎨", ui: "🎨",
  qa: "🧪", test: "🧪",
};
const MAX_DIFF_TOKENS = 150_000;
const AGENT_TIMEOUT_MS = 10 * 60 * 1000;
const OVERALL_TIMEOUT_MS = 25 * 60 * 1000;
// Kept free at the end of the run for rendering and posting the comment.
const POST_RESERVE_MS = 2 * 60 * 1000;
const MIN_COORDINATOR_MS = 60 * 1000;
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
// opencode.jsonc, all running with read-only repo tools.
// One shared agent set serves every provider: the model is overridden per-call from env
// (see callOpencode), so these names are provider-agnostic by design.
const AGENTS = {
  security: {
    name: "Security Reviewer",
    promptFile: "agents/security.md",
    opencodeAgent: "ai-review-security",
    fileFocus: f => /\.rs$|\.toml$|auth|authz|oauth|token|crypto|secret|password|unsafe/.test(f),
  },
  "code-quality": {
    name: "Code Quality Reviewer",
    promptFile: "agents/code-quality.md",
    opencodeAgent: "ai-review-code-quality",
    fileFocus: f => /\.rs$|\.ts$|\.vue$|\.js$/.test(f),
  },
  performance: {
    name: "Performance Reviewer",
    promptFile: "agents/performance.md",
    opencodeAgent: "ai-review-performance",
    fileFocus: f => /\.rs$|\.ts$|\.vue$|\.sql$/.test(f),
  },
  documentation: {
    name: "Documentation Reviewer",
    promptFile: "agents/documentation.md",
    opencodeAgent: "ai-review-documentation",
    fileFocus: () => true,
  },
  release: {
    name: "Release Reviewer",
    promptFile: "agents/release.md",
    opencodeAgent: "ai-review-release",
    fileFocus: f => /Cargo\.toml|package\.json|\.sql$|migration|Migration|\.yml$|Dockerfile|docker/.test(f),
  },
  // Reviews only the half of the ui-architect skill that no lint rule or script can see
  // (structure, cross-file consistency, i18n semantics). `requiresFocus` is what makes that
  // safe: without it, a PR with no web/ files falls back to the FULL diff and this agent
  // starts opining on Rust.
  frontend: {
    name: "Frontend UI Reviewer",
    promptFile: "agents/frontend.md",
    opencodeAgent: "ai-review-frontend",
    fileFocus: isFrontendFile,
    requiresFocus: true,
  },
  // Reviews only Playwright E2E tests + page objects (static QA: framework compliance,
  // test anti-patterns, and data-test↔component selector cross-validation). `requiresFocus`
  // keeps it off backend/app code — it only ever sees the test-file slice of the diff. Added
  // via CONDITIONAL_AGENTS so a one-line spec tweak (which is "trivial" by size) still gets it.
  qa: {
    name: "QA / Test Reviewer",
    promptFile: "agents/qa.md",
    opencodeAgent: "ai-review-qa",
    fileFocus: isTestFile,
    requiresFocus: true,
  },
};

// ─── Risk tiers ────────────────────────────────────────────────────────────
const COORDINATOR_AGENT = "ai-review-coordinator";
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

// Agents added on top of the tier's set when the diff touches their domain, regardless of size.
// A 6-line UI change is "trivial" by line count but can still hand-roll a header or freeze a
// product name in the locale catalogue, so tier alone must not decide whether it gets reviewed.
const CONDITIONAL_AGENTS = [
  { agent: "frontend", matches: isFrontendFile },
  { agent: "qa", matches: isTestFile },
];

// ─── Helpers ───────────────────────────────────────────────────────────────

function gh(args) {
  const result = execSync(`gh ${args}`, {
    encoding: "utf-8",
    maxBuffer: 50 * 1024 * 1024,
    stdio: ["pipe", "pipe", "pipe"],
    env: {
      ...process.env,
      GH_REPO: process.env.GH_REPO || process.env.GITHUB_REPOSITORY,
      NO_COLOR: "1",
      GH_NO_UPDATE_NOTIFIER: "1",
    },
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

function execErrorText(err) {
  return [err?.message, err?.stderr?.toString(), err?.stdout?.toString()].filter(Boolean).join(" ");
}

// The API refuses diffs over 20k lines; the workflow fetches the merge base into PR_DIR so the same three-dot diff can be built locally.
function fetchPrDiff(prNumber) {
  const log = message => console.log(`[${isoNow()}] ${message}`);
  const own = fetchDiff({
    repo: process.env.GITHUB_REPOSITORY,
    prNumber,
    prDir: PR_DIR,
    mergeBase: process.env.MERGE_BASE_SHA,
    head: process.env.HEAD_SHA,
    log,
  });
  if (!PAIRED.repo || !PAIRED.prNumber) return own;
  const paired = fetchDiff({
    repo: PAIRED.repo,
    prNumber: PAIRED.prNumber,
    prDir: PR_DIR && PAIRED.dir ? resolve(PR_DIR, PAIRED.dir) : "",
    mergeBase: PAIRED.mergeBase,
    head: PAIRED.head,
    log,
  });
  log(`Reviewing together with paired PR ${PAIRED.repo}#${PAIRED.prNumber} (paths prefixed with ${PAIRED.dir}/)`);
  return `${own.replace(/\n?$/, "\n")}${prefixDiffPaths(paired, PAIRED.dir)}`;
}

function pairedPrContext() {
  if (!PAIRED.repo || !PAIRED.prNumber) return "";
  try {
    const data = ghJson(`pr view "${PAIRED.prNumber}" --repo "${PAIRED.repo}" --json title,body,author`);
    return [
      ``,
      `Paired PR (same branch, reviewed together; its files are under ${PAIRED.dir}/): ${PAIRED.repo}#${PAIRED.prNumber}`,
      `Paired title: ${data.title}`,
      `Paired description: ${data.body || "N/A"}`,
    ].join("\n");
  } catch {
    return `\nPaired PR (reviewed together; its files are under ${PAIRED.dir}/): ${PAIRED.repo}#${PAIRED.prNumber}`;
  }
}

// Trusted repo rules (base-branch AGENTS.md files) that sanitize removed from the PR tree; opencode used to attach them itself.
function readRepoRules() {
  const files = (process.env.REVIEW_RULES_FILES ?? resolve(ENGINE_DIR, "AGENTS.md")).split("\n").map(f => f.trim()).filter(Boolean);
  const sections = files.filter(f => existsSync(f)).map(f => readFileSync(f, "utf-8").trim()).filter(Boolean);
  if (sections.length === 0) return "";
  return `## Repository rules (from the base branch)\n\nThese are the repository's contributor rules. Flag changed code that breaks them.\n\n${sections.join("\n\n---\n\n")}`;
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
  constructor(exporter, onResult = () => {}) {
    this.exporter = exporter;
    this.onResult = onResult;
    this.queue = Promise.resolve();
  }

  export(spans, resultCallback) {
    this.queue = this.queue
      .catch(() => {})
      .then(() => new Promise(resolve => {
        try {
          this.exporter.export(spans, result => {
            try {
              this.onResult(spans, result);
              resultCallback(result);
            } finally {
              resolve();
            }
          });
        } catch (err) {
          try {
            const result = { code: 1, error: err };
            this.onResult(spans, result);
            resultCallback(result);
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
    this.exportedSpanCount = 0;
    this.exportFailures = [];
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
      const serialExporter = new SerialTraceExporter(exporter, (spans, result) => {
        if (result.code === 0) {
          this.exportedSpanCount += spans.length;
          return;
        }
        this.exportFailures.push({
          spanNames: spans.map(span => span.name),
          error: result.error,
        });
      });
      spanProcessors.push(new BatchSpanProcessor(serialExporter, {
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

  startSpan(name, attributes = {}, parentSpan = null, kind = SpanKind.INTERNAL) {
    const parentContext = parentSpan ? trace.setSpan(context.active(), parentSpan) : undefined;
    return this.tracer.startSpan(
      name,
      { attributes: cleanAttributes(attributes), kind },
      parentContext,
    );
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
      span.recordException(error);
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

    // Bound forceFlush + shutdown so an unreachable endpoint can't stall exit; always shut down in
    // finally (a thrown forceFlush would otherwise skip it and leak handles that hang the process).
    // Stay above the configured forceFlush timeout so a healthy-but-slow endpoint isn't cut short.
    const FLUSH_DEADLINE_MS = Math.max(traceExportTimeoutMs() + 5_000, 15_000);
    const withDeadline = (label, p) => Promise.race([
      p,
      new Promise((_, reject) => {
        const t = setTimeout(() => reject(new Error(`${label} exceeded ${FLUSH_DEADLINE_MS}ms`)), FLUSH_DEADLINE_MS);
        if (typeof t.unref === "function") t.unref();
      }),
    ]);

    try {
      console.log(`[${isoNow()}] Exporting ${this.spanCount} trace spans to OpenObserve with trace ID ${this.traceId}`);
      await withDeadline("trace forceFlush", this.provider.forceFlush());
      const rejectedSpanCount = this.exportFailures.reduce((count, failure) => count + failure.spanNames.length, 0);
      if (rejectedSpanCount > 0) {
        const details = this.exportFailures
          .map(failure => `${failure.spanNames.join(",")}: ${formatTraceExportError(failure.error)}`)
          .join("; ");
        throw new Error(`trace exporter rejected ${rejectedSpanCount}/${this.spanCount} spans (${details})`);
      }
      console.log(`[${isoNow()}] Exported ${this.exportedSpanCount}/${this.spanCount} trace spans to OpenObserve`);
    } catch (err) {
      console.warn(`[${isoNow()}] Trace export failed: ${formatTraceExportError(err)}`);
    } finally {
      try {
        await withDeadline("trace shutdown", this.provider.shutdown());
      } catch (err) {
        console.warn(`[${isoNow()}] Trace provider shutdown failed: ${formatTraceExportError(err)}`);
      }
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

// Paired-repo files carry a directory prefix in the diff; path rules are written for repo-relative paths.
function logicalPath(filePath) {
  const prefix = PAIRED.dir ? `${PAIRED.dir.replace(/\/+$/, "")}/` : "";
  return prefix && filePath.startsWith(prefix) ? filePath.slice(prefix.length) : filePath;
}

function isSecuritySensitiveFile(filePath) {
  return /auth|token|secret|crypto|password|oauth|unsafe|acme|cert/i.test(filePath);
}

// Scoped to web/src on purpose: the ui-architect rules govern app UI, not the build config,
// the e2e suite or web/scripts. Specs are excluded — they carry deliberate throwaway strings
// and fixture markup that the house rules do not apply to.
function isFrontendFile(filePath) {
  if (!filePath.startsWith("web/src/")) return false;
  if (/\.(spec|test)\.[jt]sx?$/.test(filePath)) return false;
  return /\.(vue|ts|js|css)$/.test(filePath);
}

// Allowlist the Playwright E2E test-code locations under tests/ui-testing: the playwright-tests
// tree (specs + helpers), page objects, shared utils, and the suite config. The committed app
// fixtures (fixtures/ sample apps + sourcemaps — all git-tracked, so they DO reach a diff) and the
// other suites under tests/ (mobile-testing, api-testing, …) are deliberately out of remit — these
// POM/selector rules must not touch app code. No separate *.spec.js rule: every real spec lives
// under playwright-tests/**, already covered by the tree branch, and an un-anchored one would also
// pull in committed fixtures/** specs. (Archived specs under test-archives/ are gitignored, so they
// never reach a diff either way.) The tree branch takes .js or .ts: the suite is all .js today, but
// matching .ts keeps it consistent with the config branch and qa.md and future-proofs a TS
// migration — otherwise a future .ts spec would silently go unreviewed.
function isTestFile(filePath) {
  if (!filePath.startsWith("tests/ui-testing/")) return false;
  if (/^tests\/ui-testing\/(playwright-tests|pages|utils)\/.*\.(js|ts)$/.test(filePath)) return true;
  return /^tests\/ui-testing\/playwright[^/]*\.config\.[jt]s$/.test(filePath);
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

function selectAgents(tierConfig, filteredDiff) {
  const agents = [...tierConfig.agents];
  for (const { agent, matches } of CONDITIONAL_AGENTS) {
    if (agents.includes(agent)) continue;
    if (filteredDiff.files.some(f => matches(logicalPath(f.newPath)))) agents.push(agent);
  }
  return agents;
}

// ─── LLM calls (via `opencode serve`) ──────────────────────────────────────
//
// Each reviewer/coordinator is a named agent in opencode.jsonc (ai-review-*), running
// read-only against the checked-out repo via OpencodeServer + callOpencode below. Unlike
// a bare chat-completion call, opencode agents can Read/Grep the actual codebase around
// the diff, not just the diff text — that repo context is the main quality lever over the
// old DeepSeek-only approach.

const OPENCODE = new OpencodeServer({
  cwd: PR_DIR || ENGINE_DIR,
  configPath: OPENCODE_CONFIG_PATH,
  providerKeyVars: [API_KEY_VAR_NAME],
});
const MAX_TRANSIENT_RETRIES = 2;
const selfChecks = new WeakMap();

function reviewOpencodeAgents() {
  return [...new Set([...Object.values(AGENTS).map(a => a.opencodeAgent), COORDINATOR_AGENT])];
}

async function opencodeClient() {
  if (!apiKey()) throw new Error(`${API_KEY_VAR_NAME} not set`);
  const client = await OPENCODE.ensureStarted();
  if (!selfChecks.has(client)) {
    const check = selfCheck(client, reviewOpencodeAgents()).then(result => {
      console.log(`[${isoNow()}] opencode self-check passed: ${result.toolIds.length} tools known, only read/glob/grep allowed for ${result.agents} agents`);
      return result;
    });
    selfChecks.set(client, check);
  }
  await selfChecks.get(client);
  return client;
}

function remainingRunMs() {
  return OVERALL_TIMEOUT_MS - (Date.now() - startTime);
}

async function callOpencode(agentName, systemPrompt, userPrompt, timeoutMs = AGENT_TIMEOUT_MS, traceOptions = {}) {
  const llmSpan = TRACE.startSpan("gen_ai.chat", {
    "gen_ai.operation.name": "chat",
    "gen_ai.provider.name": GEN_AI_PROVIDER_NAME,
    "gen_ai.request.model": MODEL_ID,
    "gen_ai.request.reasoning_effort": MODEL_VARIANT || "default",
    "ai.review.operation.name": traceOptions.operationName || "chat",
    "ai.agent.key": traceOptions.agentKey,
    "ai.agent.name": traceOptions.agentName,
    "gen_ai.agent.name": traceOptions.agentName,
    "opencode.provider.id": PROVIDER_ID,
    "opencode.agent": agentName,
    "timeout.ms": timeoutMs,
  }, traceOptions.parentSpan, SpanKind.CLIENT);

  const truncatedSystem = systemPrompt.slice(0, 100_000);
  const truncatedUser = userPrompt.slice(0, 150_000);

  TRACE.setSpanAttributes(llmSpan, genAiRequestAttributes(truncatedSystem, truncatedUser));

  let attempt = 0;
  try {
    for (;;) {
      attempt += 1;
      try {
        const client = await opencodeClient();
        const result = await client.prompt({
          agent: agentName,
          model: { providerID: PROVIDER_ID, modelID: MODEL_ID },
          variant: MODEL_VARIANT,
          system: truncatedSystem,
          text: truncatedUser,
          title: `ai-review:${traceOptions.agentKey || agentName}`,
          timeoutMs,
        });
        if (result.rejectedPermissions > 0) {
          console.warn(`[${isoNow()}] ${agentName}: rejected ${result.rejectedPermissions} permission request(s)`);
        }
        const responseAttributes = genAiResponseAttributes({ info: result.info }, result.text, MODEL_ID);
        TRACE.setSpanAttributes(llmSpan, responseAttributes);
        TRACE.endSpan(llmSpan, {
          "gen_ai.response.id": result.responseId,
          "gen_ai.response.model": responseAttributes["gen_ai.response.model"],
          "ai.review.output.chars": result.text.length,
          "ai.review.attempts": attempt,
          "opencode.permission_rejections": result.rejectedPermissions,
        });
        return { text: result.text, responseId: result.responseId };
      } catch (err) {
        const retry = shouldRetry({
          err,
          attempt,
          maxRetries: MAX_TRANSIENT_RETRIES,
          remainingMs: remainingRunMs(),
          timeoutMs,
          reserveMs: traceOptions.agentKey === "coordinator" ? POST_RESERVE_MS : MIN_COORDINATOR_MS + POST_RESERVE_MS,
        });
        if (!retry) throw err;
        console.warn(`[${isoNow()}] ${agentName}: transient failure (${err.message}); retrying in a fresh session (attempt ${attempt + 1})`);
      }
    }
  } catch (err) {
    const timedOut = err?.name === "TimeoutError";
    TRACE.endSpan(llmSpan, { "error.timeout": timedOut, "timeout.ms": timeoutMs, "ai.review.attempts": attempt }, err);
    throw err;
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
    "gen_ai.provider.name": GEN_AI_PROVIDER_NAME,
    "opencode.provider.id": PROVIDER_ID,
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

  const systemPrompt = [readPrompt("shared-rules.md"), readRepoRules()].filter(Boolean).join("\n\n");
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
      return m && agentDef.fileFocus(logicalPath(m[2]));
    });
    if (relevant.length > 0) {
      relevantDiff = relevant.map(s => "diff --git " + s).join("");
    } else if (agentDef.requiresFocus) {
      console.log(`[${isoNow()}] ${agentDef.name}: SKIPPED — no files in focus`);
      TRACE.endSpan(reviewerSpan, { "review.skipped": true, "review.skip_reason": "no_focus_files" });
      return { agentKey, agentName: agentDef.name, findings: [], rawText: "", error: null, genAIResponseId: "", skipped: true };
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

// Anything reaching the PR goes through here: the posted review must never name the model or
// provider behind it, and a model naming itself (or an upstream error echoing the slug) would
// undo that. The vendor prefix of the ids is redacted too, so "deepseek-v4-pro" and a bare
// "DeepSeek" both go. Longest term first: alternation is first-match, so an unsorted list would
// leave the rest of a longer id behind after redacting its prefix.
function redactProviderIdentity(text) {
  const vendor = MODEL_ID.split(/[-/_]/)[0];
  const terms = [PROVIDER_ID, MODEL_ID, vendor.length >= 4 ? vendor : null]
    .filter(Boolean)
    .sort((a, b) => b.length - a.length)
    .map(t => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  if (terms.length === 0) return text;
  return text.replace(new RegExp(terms.join("|"), "gi"), "[redacted]");
}

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

  // Remove any XML boundary tags that escaped into the output.
  // NOTE: "summary" is deliberately NOT in this list — it collides with the HTML
  // <details><summary> element the review comment itself uses, and stripping it turns the
  // findings fold's clickable label into bare text. Leaked XML <summary> finding-fields are
  // already covered because they only appear inside <finding> blocks, which ARE stripped.
  const boundaryTags = ["mr_input", "mr_body", "mr_comments", "mr_details",
    "changed_files", "existing_inline_findings", "previous_review",
    "custom_review_instructions", "review_task", "pr_context", "diff",
    "all_findings", "coordinator_task", "overall_pr_context", "risk_tier",
    "reviewers_ran", "failed_reviewers", "reviewer", "findings", "finding", "no-issues",
    "category", "severity", "file", "line", "description", "suggestion"];
  const boundaryPattern = new RegExp(`</?(${boundaryTags.join("|")})[^>]*>`, "gi");
  cleaned = cleaned.replace(boundaryPattern, "");

  // Strip EVERY marker (not just ours) wherever it appears, so a model that echoes a marker
  // from the prompt or from a previous review can't end up carrying two of them.
  cleaned = cleaned.replace(new RegExp(ANY_REVIEW_MARKER, "gi"), "");

  // Drop any preamble the model emitted before the review proper ("Now I have all the
  // context. Let me produce the consolidated review."). Runs after marker stripping so a
  // leading marker can't anchor the search at index 0 and mask the preamble behind it.
  const headingAt = cleaned.search(REVIEW_HEADING_RE);
  if (headingAt > 0) cleaned = cleaned.slice(headingAt);

  // Re-prepend exactly one marker — ours.
  cleaned = `${REVIEW_MARKER}\n${cleaned.trimStart()}`;

  // Normalize the review heading to the branded title, dropping any trailing "(Label)" an older
  // comment or the model itself appended — the posted review must not name the model.
  cleaned = cleaned.replace(
    /^#{1,3}[ \t]*(?:🔎[ \t]*)?(?:OpenObserve Code Review|AI Code Review)\b[ \t]*[^\n]*$/mi,
    REVIEW_HEADING,
  );

  const scrubbed = scrubReviewBody(redactProviderIdentity(cleaned.trim()), process.env);
  if (scrubbed.secretHits > 0) {
    console.warn(`[${isoNow()}] Redacted ${scrubbed.secretHits} secret-shaped value(s) from the review before posting`);
    TRACE.setSpanAttributes(activeRootSpan, { "security.output_scrub.hits": scrubbed.secretHits });
  }
  return scrubbed.text;
}

// ─── Coordinator pass ─────────────────────────────────────────────────────

async function runCoordinator(agentResults, prContext, tier, existingReview, parentSpan) {
  const coordinatorPrompt = readPrompt("agents/coordinator.md");
  const sharedRules = [readPrompt("shared-rules.md"), readRepoRules()].filter(Boolean).join("\n\n");

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

  // Authoritative list of reviewers that actually ran (not skipped, not failed). The coordinator
  // must render the "Reviewers" row from THIS, not infer it — a reviewer with no findings sends no
  // <reviewer> block, so without this the LLM guesses and can invent an agent that never ran.
  const ranReviewers = agentResults.filter(r => !r.error && !r.skipped).map(r => r.agentName);

  const userPrompt = [
    `<coordinator_task>`,
    `<overall_pr_context>${prContext}</overall_pr_context>`,
    `<risk_tier>${tier}</risk_tier>`,
    `<reviewers_ran>${ranReviewers.join(", ")}</reviewers_ran>`,
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
    "gen_ai.provider.name": GEN_AI_PROVIDER_NAME,
    "opencode.provider.id": PROVIDER_ID,
    "gen_ai.request.model": MODEL_ID,
    "review.risk_tier": tier,
    "review.findings": agentResults.reduce((sum, r) => sum + r.findings.length, 0),
    "review.failed_agents": agentResults.filter(r => r.error).length,
  }, parentSpan);

  console.log(`[${isoNow()}] Running coordinator (${MODEL_SLUG}, ${coordinatorAgent})`);

  try {
    // Reviewer retries can eat into the run, so the coordinator gets what is left rather than a fixed slot past the watchdog.
    const timeoutMs = Math.min(AGENT_TIMEOUT_MS, remainingRunMs() - POST_RESERVE_MS);
    if (timeoutMs < MIN_COORDINATOR_MS) throw new Error(`only ${Math.round(remainingRunMs() / 1000)}s left in the run`);
    const completion = await callOpencode(coordinatorAgent, `${sharedRules}\n\n${coordinatorPrompt}`, userPrompt, timeoutMs, {
      parentSpan: coordinatorSpan,
      agentKey: "coordinator",
      agentName: "Coordinator",
      operationName: "code_review.coordination",
    });
    TRACE.endSpan(coordinatorSpan, {
      "review.output_length": completion.text.length,
      "gen_ai.response.id": completion.responseId,
    });
    return {
      text: completion.text,
      genAIResponseId: completion.responseId,
      fallback: false,
      error: null,
    };
  } catch (err) {
    console.error(`[${isoNow()}] Coordinator failed: ${err.message}`);
    const fallback = buildFallbackReview(agentResults, tier, failedAgents);
    TRACE.endSpan(coordinatorSpan, {
      "review.fallback": true,
      "review.output_length": fallback.length,
    }, err);
    return {
      text: fallback,
      genAIResponseId: "",
      fallback: true,
      error: err.message,
    };
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
${REVIEW_HEADING}

> [!TIP]
> ### ✅ Approved
> LGTM — No issues found by automated reviewers.

**🔴 0 blockers · 🟡 0 warnings · 🔵 0 suggestions**

<details>
<summary>🧾 Review details</summary>

- Risk tier: ${tier}
${failedAgents.length > 0 ? `- Failed reviewers: ${failedAgents.map(r => r.agentName).join(", ")}` : ""}

</details>`;
  }

  const findingLine = f => {
    const glyph = CATEGORY_GLYPH[(f.category || "").toLowerCase()] || "•";
    const loc = f.file && f.line && f.line !== "0" ? `\`${f.file}:${f.line}\` ` : f.file ? `\`${f.file}\` ` : "";
    const cat = f.category ? `**[${f.category.charAt(0).toUpperCase() + f.category.slice(1)}]** ` : "";
    const fix = f.suggestion ? ` (→ ${f.suggestion})` : "";
    return `- ${glyph} ${loc}${cat}${f.summary}${fix}`;
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
${REVIEW_HEADING}

> [!NOTE]
> ### 💬 Approved with comments
> Automated review — ${failedAgents.length > 0 ? "some reviewers failed and " : ""}coordinator consolidation was skipped. Findings below are deduplicated but un-judged.${failureNote}${dedupNote}

**🔴 ${bySeverity.critical.length} blocker · 🟡 ${bySeverity.warning.length} warning · 🔵 ${bySeverity.suggestion.length} suggestion**

<details open>
<summary>📋 Show findings (${sorted.length})</summary>

${sections.join("\n")}

---

- Risk tier: ${tier}
- Reviewers completed: ${agentResults.filter(r => !r.error && !r.skipped).map(r => r.agentName).join(", ") || "none"}
${failedAgents.length > 0 ? `- Failed reviewers: ${failedAgents.map(r => r.agentName).join(", ")}` : ""}

</details>`;
}

// ─── GitHub integration ────────────────────────────────────────────────────

function findExistingReviewComment(prNumber) {
  if (!REVIEW_BOT_LOGIN) {
    console.log(`[${isoNow()}] REVIEW_BOT_LOGIN is not set; not looking for a previous review`);
    return null;
  }
  try {
    const pages = JSON.parse(gh(`api --paginate --slurp "repos/${process.env.GITHUB_REPOSITORY}/issues/${prNumber}/comments"`));
    return selectOwnReviewComment(pages.flat(), REVIEW_BOT_LOGIN, ANY_REVIEW_MARKER);
  } catch (err) {
    console.warn(`[${isoNow()}] Could not list PR comments, so no previous review is used: ${execErrorText(err).slice(0, 300)}`);
    return null;
  }
}

function postReviewComment(prNumber, body) {
  const tmpFile = `/tmp/review_comment_${randomUUID()}.txt`;
  writeFileSync(tmpFile, body, "utf-8");
  try {
    const out = gh(`pr comment "${prNumber}" --body-file "${tmpFile}"`);
    const m = out.match(/#issuecomment-(\d+)/);
    return m ? m[1] : null;
  } finally {
    try { unlinkSync(tmpFile); } catch {}
  }
}

function updateReviewComment(prNumber, commentId, body) {
  const payload = JSON.stringify({ body });
  const tmpFile = `/tmp/review_comment_${randomUUID()}.json`;
  writeFileSync(tmpFile, payload);
  try {
    gh(`api "repos/${process.env.GITHUB_REPOSITORY}/issues/comments/${commentId}" --method PATCH --input "${tmpFile}"`);
    return { action: "update", id: commentId };
  } catch (err) {
    // The comment we captured at the start of the run was deleted mid-run (e.g. someone cleared
    // the review thread). Post a fresh comment instead of failing the whole review on a 404.
    const detail = execErrorText(err);
    if (/HTTP 404|Not Found/i.test(detail)) {
      console.log(`[${isoNow()}] Review comment #${commentId} no longer exists (404); posting a new comment instead`);
      return { action: "create", id: postReviewComment(prNumber, body) };
    }
    throw err;
  } finally {
    try { unlinkSync(tmpFile); } catch {}
  }
}

// ─── Main ──────────────────────────────────────────────────────────────────

function prepareReviewTree(rootSpan) {
  if (!PR_DIR) {
    if (process.env.GITHUB_ACTIONS === "true") throw new Error("PR_DIR is required in CI: the PR must be reviewed from its own sanitized checkout");
    console.warn(`[${isoNow()}] PR_DIR not set; local run reviews ${ENGINE_DIR} without sanitizing it`);
    return;
  }
  const result = sanitizePrTree(PR_DIR, ENGINE_DIR);
  for (const item of result.removed) console.log(`[${isoNow()}] sanitize: removed ${item.path} (${item.reason})`);
  console.log(`[${isoNow()}] sanitize: ${result.removed.length} item(s) removed, review context: ${result.contextFiles.join(", ") || "none"}`);
  TRACE.setSpanAttributes(rootSpan, {
    "review.sanitize.removed": result.removed.length,
    "review.sanitize.symlinks": result.removed.filter(r => r.reason === "symlink").length,
    "review.engine_dir": ENGINE_DIR,
  });
}

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
    prepareReviewTree(rootSpan);

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
      const message = `${API_KEY_VAR_NAME} is not set. OpenObserve Code Review did not run for this PR — this is a CI misconfiguration, not a skip.`;
      console.error(`[${isoNow()}] ${message}`);
      try {
        // The key's env var name is named in the log but not in the comment: it carries the
        // provider name, and the posted comment must not.
        const notice = `${REVIEW_MARKER}\n${NOTICE_TAG}\n${REVIEW_HEADING}\n\n> [!CAUTION]\n> ### ⛔ Not reviewed\n> The review API key is not set. OpenObserve Code Review did not run for this PR — this is a CI misconfiguration, not a skip. Please confirm the review secrets are provisioned.`;
        const existing = findExistingReviewComment(prNumber);
        if (existing) updateReviewComment(prNumber, existing.id, notice);
        else postReviewComment(prNumber, notice);
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
      "diff.filtered.sha256": sha256(filtered.diff),
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
    const selectedAgents = selectAgents(tierConfig, filtered);
    TRACE.endSpan(riskSpan, {
      "review.risk_tier": tier,
      "review.agent_count": selectedAgents.length,
      "review.agents": selectedAgents,
    });
    TRACE.setSpanAttributes(rootSpan, {
      "review.risk_tier": tier,
      "review.agent_count": selectedAgents.length,
      "review.agents": selectedAgents,
      "diff.changed_lines": changedLines,
      "diff.filtered_files": filtered.files.length,
      "diff.filtered.sha256": sha256(filtered.diff),
    });
    console.log(`[${isoNow()}] Risk tier: ${tier} → agents: [${selectedAgents.join(", ")}]`);

    // 4. PR context
    let prContext = `PR #${prNumber} in ${process.env.GITHUB_REPOSITORY}`;
    const contextSpan = TRACE.startSpan("github.pr.context", { "github.pr.number": prNumber }, rootSpan);
    try {
      const prData = ghJson(`pr view "${prNumber}" --json title,body,author,files,baseRefOid,headRefOid`);
      prContext = [
        `Repository: ${process.env.GITHUB_REPOSITORY}`,
        `PR: #${prNumber}`,
        `Title: ${prData.title}`,
        `Author: ${prData.author?.login || "unknown"}`,
        `Files changed: ${prData.files?.length || filtered.files.length}`,
        `Description: ${prData.body || "N/A"}`,
      ].join("\n") + pairedPrContext();
      TRACE.endSpan(contextSpan, {
        "github.pr.author": prData.author?.login || "unknown",
        "github.pr.file_count": prData.files?.length || filtered.files.length,
        "github.pr.body_present": Boolean(prData.body),
        "github.pr.base.sha": prData.baseRefOid,
        "github.pr.head.sha": prData.headRefOid,
      });
      TRACE.setSpanAttributes(rootSpan, {
        "github.pr.base.sha": prData.baseRefOid,
        "github.pr.head.sha": prData.headRefOid,
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
      if (existingComment.body.includes(PAIRED_POINTER_TAG) || existingComment.body.includes(NOTICE_TAG)) {
        console.log(`[${isoNow()}] Replacing pointer/notice comment #${existingCommentId} with a review`);
      } else {
        existingReview = existingComment.body;
        console.log(`[${isoNow()}] Re-review mode: found existing review comment #${existingCommentId}`);
      }
    }

    // 6. Run reviewers in parallel
    const agentsToRun = selectedAgents;
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
    // A requiresFocus agent that saw no files in its domain opted out — it is neither expected
    // nor completed, so it must not count toward coverage.
    const ranResults = results.filter(r => !r.skipped);
    const failedAgents = ranResults.filter(r => r.error);
    const completedAgents = ranResults.filter(r => !r.error);
    const failedAgentNames = failedAgents.map(r => r.agentName);
    const failureReasons = Object.fromEntries(
      failedAgents.map(r => [r.agentName, r.error]),
    );
    const coverageRatio = ranResults.length > 0 ? completedAgents.length / ranResults.length : 0;
    if (failedAgents.length > 0 && failedAgents.length < ranResults.length) {
      outcome = "partial_success";
    }
    const reviewerResponseIds = results.map(r => r.genAIResponseId).filter(Boolean);
    TRACE.setSpanAttributes(rootSpan, {
      "review.total_findings": totalFindings,
      "review.failed_agents": failedAgents.length,
      "review.failed_agent_names": failedAgentNames,
      "review.failure_reasons": failureReasons,
      "review.completed_agents": completedAgents.map(r => r.agentName),
      "review.completed_agent_count": completedAgents.length,
      "review.expected_agent_count": ranResults.length,
      "review.coverage_ratio": coverageRatio,
      "review.degraded": failedAgents.length > 0,
    });
    console.log(`[${isoNow()}] All reviewers complete. Total findings: ${totalFindings}, Failures: ${failedAgents.length}`);

    // 7. Coordinator pass — unless nothing survived to coordinate.
    //
    // If EVERY reviewer failed there are no findings to consolidate, so the coordinator can
    // only produce "no issues found" — which reads as an approval on a PR that was never
    // actually reviewed. That is strictly worse than posting nothing: it is a green light
    // manufactured from a total outage. Report the failure instead, skip the coordinator
    // (saving another AGENT_TIMEOUT_MS of waiting on a provider that is already failing),
    // and exit non-zero so the check surfaces as red.
    const allAgentsFailed = ranResults.length > 0 && failedAgents.length === ranResults.length;
    let finalReview;
    let responseIds = reviewerResponseIds;

    if (allAgentsFailed) {
      outcome = "all_agents_failed";
      exitCode = 1;
      const detail = failedAgents
        .map(r => `- ${r.agentName}: ${r.error}`)
        .join("\n");
      console.error(`[${isoNow()}] All ${ranResults.length} reviewers failed — skipping coordinator and reporting failure.`);
      TRACE.setSpanAttributes(rootSpan, {
        "review.all_agents_failed": true,
        "review.coordinator_skipped": true,
      });
      finalReview = [
        REVIEW_HEADING,
        ``,
        `> [!CAUTION]`,
        `> ### ⛔ Not reviewed`,
        `> All ${ranResults.length} reviewers failed, so there are no findings to report — this is an infrastructure failure, not an approval.`,
        ``,
        `<details>`,
        `<summary>🧾 Reviewer failures (${failedAgents.length})</summary>`,
        ``,
        detail,
        ``,
        `</details>`,
      ].join("\n");
    } else {
      const coordinatorResult = await runCoordinator(results, prContext, tier, existingReview, rootSpan);
      finalReview = coordinatorResult.text;
      responseIds = [...reviewerResponseIds, coordinatorResult.genAIResponseId].filter(Boolean);
      if (coordinatorResult.fallback) {
        outcome = "partial_success";
        TRACE.setSpanAttributes(rootSpan, {
          "review.degraded": true,
          "review.coordinator_failed": true,
          "review.coordinator_error": coordinatorResult.error,
        });
      }
    }

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
    const requestedAction = existingCommentId ? "update" : "create";
    const commentSpan = TRACE.startSpan("github.pr.review_comment", {
      "github.pr.comment.action": requestedAction,
      "github.pr.number": prNumber,
    }, rootSpan);
    try {
      let commentResult;
      if (existingCommentId) {
        console.log(`[${isoNow()}] Updating existing review comment #${existingCommentId}`);
        commentResult = updateReviewComment(prNumber, existingCommentId, finalReview);
      } else {
        console.log(`[${isoNow()}] Posting new review comment`);
        commentResult = { action: "create", id: postReviewComment(prNumber, finalReview) };
      }
      TRACE.endSpan(commentSpan, {
        "github.pr.comment.action": commentResult.action,
        "github.pr.comment.id": commentResult.id,
      });
    } catch (err) {
      TRACE.endSpan(commentSpan, {}, err);
      throw err;
    }

    // The failure notice is posted above so it is visible on the PR; now fail the check too,
    // so a total reviewer outage can't pass as a green tick. Thrown after the comment lands
    // (not at detection time) to guarantee both happen.
    if (allAgentsFailed) {
      const err = new Error(`All ${ranResults.length} reviewers failed against ${MODEL_SLUG}; no review was produced.`);
      err.suppressFatalLog = true;
      throw err;
    }

    console.log(`[${isoNow()}] AI Code Review complete for PR #${prNumber}`);
  } catch (err) {
    rootError = err;
    exitCode = 1;
    if (outcome !== "misconfigured" && outcome !== "all_agents_failed") outcome = "failure";
    throw err;
  } finally {
    TRACE.endSpan(rootSpan, {
      "workflow.outcome": outcome,
      "review.outcome": outcome,
      "review.degraded": outcome === "partial_success",
      "process.exit_code": exitCode,
    }, rootError);
    activeRootSpan = null;
    OPENCODE.stop();
  }
}

// ─── Entry point ───────────────────────────────────────────────────────────

// Let the loop drain (so stdout isn't truncated); unref'd 1s backstop forces exit if OTel handles linger.
function finishAndExit(code) {
  process.exitCode = code;
  const t = setTimeout(() => process.exit(code), 1000);
  if (typeof t.unref === "function") t.unref();
}

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
    finishAndExit(0);
  })
  .catch(async err => {
    clearTimeout(timeout);
    if (!err.suppressFatalLog) console.error(`[${isoNow()}] Fatal error:`, err);
    await TRACE.flush();
    finishAndExit(1);
  });
