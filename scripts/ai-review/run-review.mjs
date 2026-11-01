import { execSync } from "node:child_process";
import { readFileSync, existsSync, writeFileSync, unlinkSync, mkdirSync } from "node:fs";
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
  addUsage,
  cleanAttributes,
  genAiRequestAttributes,
  genAiResponseAttributes,
  genAiUsageAttributes,
  sha256,
} from "./telemetry.mjs";
import {
  autoApproveLine,
  createAutoApproveGate,
  isApprovedReview,
  parseAutoApproveMode,
  parseRawDiff,
  reviewerFacts,
  sizeReasons,
} from "./src/auto-approve.mjs";
import {
  ANY_REVIEW_MARKER,
  REVIEW_HEADING,
  REVIEW_TITLE,
  bodyAtPassLimit,
  bodyAtReviewedHead,
  bodyAtUnreviewedHead,
  claimedReviewBody,
  finishReviewBody,
  parseMaxPasses,
  previousReviewText,
  redactProviderIdentity,
  reviewKey,
  reviewPassCount,
  reviewSkipReason,
  sanitizeReviewBody,
  selectOwnReviewComment,
  withPassTag,
} from "./src/comments.mjs";
import {
  buildReviewPayload,
  existingFingerprints,
  extractInlineBlock,
  rightSideLines,
  selectInlineComments,
} from "./src/inline.mjs";
import { changedCodeEvidence, mergeConfidence, reviewerFinished, severityCounts, unfinishedReviewers } from "./src/confidence.mjs";
import { OpencodeServer, resolveOpencodeConfig, selfCheck, shouldRetry } from "./src/opencode.mjs";
import { fetchPinnedDiff, prefixDiffPaths, reviewerDiff } from "./src/pr-diff.mjs";
import {
  buildFallbackReview,
  partialFindingsBlock,
  failedReviewersNote,
  insertAfterCallout,
  mapStrings,
  parseFindings,
  reviewerReported,
  selectFallbackFindings,
  toKeptFinding,
} from "./src/report.mjs";
import { sanitizePrTree } from "./src/sanitize.mjs";
import { scrubReviewBody, scrubSecrets } from "./src/scrub.mjs";
import { isReleaseFile, resolveRulesFiles } from "./src/selection.mjs";
import { buildImpactContext } from "./src/impact.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));

// ENGINE_DIR is the trusted base-branch checkout; PR_DIR is the PR head, which is data only and never executed.
const ENGINE_DIR = resolve(process.env.ENGINE_DIR || resolve(__dirname, "../.."));
const PR_DIR = process.env.PR_DIR ? resolve(process.env.PR_DIR) : "";
// REVIEW_OPENCODE_CONFIG: "default" (opencode.jsonc, read-only tools) or "ci-full" (opencode.ci.jsonc, every tool allowed).
const OPENCODE_CONFIG = resolveOpencodeConfig(process.env.REVIEW_OPENCODE_CONFIG);
const OPENCODE_CONFIG_PATH = resolve(ENGINE_DIR, OPENCODE_CONFIG.file);
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
// currently has a single deepseek leg). Everything defaults to that DeepSeek-V4.1-Flash (max effort) setup, so an
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
const MODEL_ID = process.env.REVIEW_MODEL_ID || "deepseek-flash";
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

// Tags the "reviewed with the paired o2-enterprise PR" note (post-paired-pointer.sh); it is replaced in place but is not a previous review.
const PAIRED_POINTER_TAG = "<!-- o2-paired-pointer -->";
// Tags the "not reviewed: key not set" notice, which is likewise replaced but never fed back as a previous review.
const NOTICE_TAG = "<!-- o2-review-notice -->";
// Login of the token that posts the review; anyone else's comment carrying the marker must never become <previous_review>.
const REVIEW_BOT_LOGIN = process.env.REVIEW_BOT_LOGIN || "";
// Inline review comments are opt-in; the summary comment is posted either way.
const REVIEW_INLINE = (process.env.REVIEW_INLINE || "false").toLowerCase() === "true";
// Optional ceiling on paid reviews per PR, 0 for none; the count lives in the review comment, so deleting that comment resets it.
const REVIEW_MAX_PASSES = parseMaxPasses(process.env.REVIEW_MAX_PASSES);
const REVIEW_IGNORE_PASS_LIMIT = process.env.REVIEW_IGNORE_PASS_LIMIT === "true";
// Anything but an exact known mode is "off": the gate must be opted into.
const AUTO_APPROVE_MODE = parseAutoApproveMode(process.env.REVIEW_AUTO_APPROVE);
// Only the workflow's "no open PR on this branch" path sets this; any failed or skipped pairing lookup leaves it unset.
const REVIEW_PAIR_CLEAR = process.env.REVIEW_PAIR_CLEAR === "true";
// Where the raw findings JSON is written for the workflow to upload; unset skips it.
const REVIEW_ARTIFACT_DIR = process.env.REVIEW_ARTIFACT_DIR || "";

const MAX_DIFF_TOKENS = 150_000;
const UNPARSEABLE_OUTPUT = "output was cut off or held neither findings nor a no-issues marker";
const AGENT_TIMEOUT_MS = 20 * 60 * 1000;
const OVERALL_TIMEOUT_MS = 40 * 60 * 1000;
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
    checklist: true,
    opencodeAgent: "ai-review-security",
    fileFocus: f => /\.rs$|\.toml$|auth|authz|oauth|token|crypto|secret|password|unsafe/.test(f),
  },
  // Owns the PR's behaviour end to end: the change, its callers and consumers, sibling paths, state.
  correctness: {
    name: "Correctness Reviewer",
    promptFile: "agents/correctness.md",
    checklist: true,
    opencodeAgent: "ai-review-correctness",
    fileFocus: f => /\.(rs|ts|tsx|js|mjs|vue|py|go|sql)$/.test(f),
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
    fileFocus: isReleaseFile,
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
    agents: ["correctness", "code-quality"],
    coordinatorAgent: COORDINATOR_AGENT,
  },
  lite: {
    maxLines: 100,
    maxFiles: 20,
    agents: ["correctness", "code-quality", "documentation"],
    coordinatorAgent: COORDINATOR_AGENT,
  },
  full: {
    agents: ["security", "correctness", "code-quality", "performance", "documentation"],
    coordinatorAgent: COORDINATOR_AGENT,
  },
};

// Agents added on top of the tier's set when the diff touches their domain, regardless of size.
// A 6-line UI change is "trivial" by line count but can still hand-roll a header or freeze a
// product name in the locale catalogue, so tier alone must not decide whether it gets reviewed.
const CONDITIONAL_AGENTS = [
  { agent: "frontend", matches: isFrontendFile },
  { agent: "qa", matches: isTestFile },
  // Release reviews only what can affect a release (migrations, manifests, config, CI, deploy); most PRs touch none of it.
  { agent: "release", matches: isReleaseFile },
];

// ─── Helpers ───────────────────────────────────────────────────────────────

function gh(args, input) {
  const result = execSync(`gh ${args}`, {
    encoding: "utf-8",
    maxBuffer: 50 * 1024 * 1024,
    input,
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
  const own = fetchPinnedDiff({
    repo: process.env.GITHUB_REPOSITORY,
    prNumber,
    prDir: PR_DIR,
    mergeBase: process.env.MERGE_BASE_SHA,
    head: process.env.HEAD_SHA,
    log,
  });
  if (!PAIRED.repo || !PAIRED.prNumber) return { diff: own.diff, own: own.diff, pinned: own.pinned };
  const paired = fetchPinnedDiff({
    repo: PAIRED.repo,
    prNumber: PAIRED.prNumber,
    prDir: PR_DIR && PAIRED.dir ? resolve(PR_DIR, PAIRED.dir) : "",
    mergeBase: PAIRED.mergeBase,
    head: PAIRED.head,
    log,
  });
  log(`Reviewing together with paired PR ${PAIRED.repo}#${PAIRED.prNumber} (paths prefixed with ${PAIRED.dir}/)`);
  // The review key names both heads, so both sides must be pinned for it to be true.
  return { diff: `${own.diff.replace(/\n?$/, "\n")}${prefixDiffPaths(paired.diff, PAIRED.dir)}`, own: own.diff, pinned: own.pinned && paired.pinned };
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

// Trusted repo rules (base-branch AGENTS.md files, or CLAUDE.md where there is no AGENTS.md) that sanitize removed from the PR tree; opencode used to attach them itself.
function readRepoRules() {
  const files = (process.env.REVIEW_RULES_FILES ?? resolve(ENGINE_DIR, "AGENTS.md")).split("\n").map(f => f.trim()).filter(Boolean);
  const sections = resolveRulesFiles(files).map(f => readFileSync(f, "utf-8").trim()).filter(Boolean);
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
      // A forceFlush timeout hides the per-span exporter errors that would say why.
      for (const failure of /exporter rejected/.test(err?.message || "") ? [] : this.exportFailures) {
        console.warn(`[${isoNow()}]   ${failure.spanNames.join(",")}: ${formatTraceExportError(failure.error)}`);
      }
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
  readOnly: OPENCODE_CONFIG.readOnly,
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
    const check = selfCheck(client, reviewOpencodeAgents(), { readOnly: OPENCODE_CONFIG.readOnly }).then(result => {
      const grant = OPENCODE_CONFIG.readOnly ? "only read/glob/grep allowed" : "every tool allowed (ci-full)";
      console.log(`[${isoNow()}] opencode self-check passed: ${result.plugins} built-in plugins, ${grant} for ${result.agents} agents`);
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
  let failedUsage = null;
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
        const info = failedUsage ? { ...result.info, ...addUsage(failedUsage, result.info) } : result.info;
        const responseAttributes = genAiResponseAttributes({ info }, result.text, MODEL_ID);
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
        failedUsage = addUsage(failedUsage, err?.usage);
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
    if (failedUsage) TRACE.setSpanAttributes(llmSpan, genAiUsageAttributes(failedUsage));
    TRACE.endSpan(llmSpan, { "error.timeout": timedOut, "timeout.ms": timeoutMs, "ai.review.attempts": attempt }, err);
    throw err;
  }
}

// ─── Run single reviewer ──────────────────────────────────────────────────

async function runReviewer(agentKey, agentDef, diff, prContext, existingReview, parentSpan, impact = "", unfocused = false) {
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
  // The repo checklist (recurring OpenObserve defect classes) goes to the reviewers that hunt bugs.
  const agentPrompt = [readPrompt(agentDef.promptFile), agentDef.checklist ? readPrompt("openobserve-checklist.md") : ""].filter(Boolean).join("\n\n");
  if (!agentPrompt) {
    const err = new Error(`Missing agent prompt: ${agentDef.promptFile}`);
    TRACE.endSpan(reviewerSpan, {}, err);
    throw err;
  }

  const { diff: relevantDiff, skipped, fullDiff } = reviewerDiff(diff, agentDef, { unfocused, pathOf: logicalPath });
  if (skipped) {
    console.log(`[${isoNow()}] ${agentDef.name}: SKIPPED — no files in focus`);
    TRACE.endSpan(reviewerSpan, { "review.skipped": true, "review.skip_reason": "no_focus_files" });
    return { agentKey, agentName: agentDef.name, findings: [], rawText: "", error: null, genAIResponseId: "", skipped: true };
  }

  const userPrompt = [
    `<review_task>`,
    `<pr_context>${prContext}</pr_context>`,
    `<diff>${relevantDiff.slice(0, MAX_DIFF_TOKENS)}</diff>`,
    impact ? `<impact_map>\nWhere symbols this PR changes are used outside the diff (DEF = another definition of the same name, possibly a parallel implementation). Generated by grep; verify before relying on it.\n${impact}\n</impact_map>` : "",
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
    const parsed = reviewerReported(text, findings);
    if (!parsed) {
      console.log(`[${isoNow()}] ${agentDef.name}: ${UNPARSEABLE_OUTPUT}`);
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
    return { agentKey, agentName: agentDef.name, findings, rawText: text, error: null, genAIResponseId: completion.responseId, fullDiff, parsed };
  } catch (err) {
    const elapsed = ((Date.now() - start) / 1000).toFixed(1);
    console.error(`[${isoNow()}] ${agentDef.name} FAILED after ${elapsed}s: ${err.message}`);
    TRACE.endSpan(reviewerSpan, { "review.elapsed_seconds": Number(elapsed) }, err);
    return { agentKey, agentName: agentDef.name, findings: [], rawText: "", error: err.message, timedOut: err?.name === "TimeoutError", genAIResponseId: "" };
  }
}

// ─── Sanitization ──────────────────────────────────────────────────────────

// Anything reaching the PR goes through here: the posted review must never name the model or provider behind it.
function redactIdentity(text) {
  return redactProviderIdentity(text, { providerId: PROVIDER_ID, modelId: MODEL_ID });
}

function sanitizeForPosting(body) {
  const { text, secretHits } = sanitizeReviewBody(body, { marker: REVIEW_MARKER, providerId: PROVIDER_ID, modelId: MODEL_ID, env: process.env });
  if (secretHits > 0) {
    console.warn(`[${isoNow()}] Redacted ${secretHits} secret-shaped value(s) from the review before posting`);
    TRACE.setSpanAttributes(activeRootSpan, { "security.output_scrub.hits": secretHits });
  }
  return text;
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

  const failedAgents = agentResults.filter(r => !r.skipped && !reviewerFinished(r));
  const failedNote = failedAgents.length > 0
    ? `\n<failed_reviewers>${failedAgents.map(r => r.agentName).join(", ")}</failed_reviewers>`
    : "";

  // Authoritative list of reviewers that actually ran (not skipped, not failed). The coordinator
  // must render the "Reviewers" row from THIS, not infer it — a reviewer with no findings sends no
  // <reviewer> block, so without this the LLM guesses and can invent an agent that never ran.
  const ranReviewers = agentResults.filter(reviewerFinished).map(r => r.agentName);

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
    "review.failed_agents": failedAgents.length,
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
    // The machine-readable list of kept findings never reaches the summary comment.
    const inline = extractInlineBlock(completion.text);
    if (inline.error) console.warn(`[${isoNow()}] Coordinator inline block: ${inline.error}; no inline comments from it`);
    TRACE.endSpan(coordinatorSpan, {
      "review.output_length": completion.text.length,
      "gen_ai.response.id": completion.responseId,
      "review.kept_findings": inline.findings.length,
    });
    return {
      text: inline.text,
      kept: inline.findings,
      findingsKnown: !inline.error,
      genAIResponseId: completion.responseId,
      fallback: false,
      error: null,
    };
  } catch (err) {
    console.error(`[${isoNow()}] Coordinator failed: ${err.message}`);
    const fallback = buildFallbackReview(agentResults, tier, failedAgents, REVIEW_MARKER);
    TRACE.endSpan(coordinatorSpan, {
      "review.fallback": true,
      "review.output_length": fallback.length,
    }, err);
    return {
      text: fallback,
      kept: selectFallbackFindings(agentResults).map(toKeptFinding),
      findingsKnown: true,
      genAIResponseId: "",
      fallback: true,
      error: err.message,
    };
  }
}

// ─── GitHub integration ────────────────────────────────────────────────────

// ok is false when the bot's comments could not be read, so neither the previous review nor the pass count is known.
function findExistingReviewComment(prNumber) {
  if (!REVIEW_BOT_LOGIN) {
    console.log(`[${isoNow()}] REVIEW_BOT_LOGIN is not set; not looking for a previous review`);
    return { comment: null, ok: false };
  }
  try {
    const pages = JSON.parse(gh(`api --paginate --slurp "repos/${process.env.GITHUB_REPOSITORY}/issues/${prNumber}/comments"`));
    return { comment: selectOwnReviewComment(pages.flat(), REVIEW_BOT_LOGIN, ANY_REVIEW_MARKER), ok: true };
  } catch (err) {
    console.warn(`[${isoNow()}] Could not list PR comments, so no previous review is used: ${execErrorText(err).slice(0, 300)}`);
    return { comment: null, ok: false };
  }
}

function isPlaceholderComment(body) {
  return body.includes(PAIRED_POINTER_TAG) || body.includes(NOTICE_TAG);
}

function passesDoneIn(comment) {
  if (!comment) return 0;
  return reviewPassCount(comment.body, isPlaceholderComment(comment.body) ? 0 : 1);
}

// Recorded before any reviewer starts, so a run stopped midway (label removed, draft, crash) still uses up its pass; returns the comment id.
function claimReviewPass(prNumber, existingComment, count, key) {
  if (existingComment) {
    return updateReviewComment(prNumber, existingComment.id, claimedReviewBody(existingComment.body, count, key)).id;
  }
  const placeholder = `${REVIEW_MARKER}\n${NOTICE_TAG}\n${REVIEW_HEADING}\n\n> [!NOTE]\n> Review in progress.`;
  return postReviewComment(prNumber, withPassTag(placeholder, count));
}

// Advisory like the review: the skip stands whether or not the note lands.
function noteOnComment(prNumber, comment, body) {
  if (body === comment.body) return;
  try {
    updateReviewComment(prNumber, comment.id, body);
  } catch (err) {
    console.warn(`[${isoNow()}] Could not update the review comment: ${execErrorText(err).slice(0, 300)}`);
  }
}

// Costs no pass: nothing was reviewed, but a verdict covers one commit and this push is not that commit.
function noteUnreviewedHead(prNumber, comment, key) {
  if (comment) noteOnComment(prNumber, comment, bodyAtUnreviewedHead(comment.body, key));
}

// Costs no pass and calls no model: the commit was reviewed, only a run that stopped on another head left its line behind.
function noteReviewedHead(prNumber, comment) {
  noteOnComment(prNumber, comment, bodyAtReviewedHead(comment.body, REVIEW_MAX_PASSES));
}

function noteSkippedPush(prNumber, comment, key) {
  noteOnComment(prNumber, comment, bodyAtPassLimit(comment.body, REVIEW_MAX_PASSES, key));
}

function postReviewComment(prNumber, body) {
  const tmpFile = `/tmp/review_comment_${randomUUID()}.json`;
  writeFileSync(tmpFile, JSON.stringify({ body }));
  try {
    return gh(`api "repos/${process.env.GITHUB_REPOSITORY}/issues/${prNumber}/comments" --method POST --input "${tmpFile}" --jq .id`) || null;
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

function githubReviewApi(prNumber) {
  const repoPath = `repos/${process.env.GITHUB_REPOSITORY}/pulls/${prNumber}`;
  return {
    readPr: () => JSON.parse(gh(`api "${repoPath}"`)),
    listReviews: () => JSON.parse(gh(`api --paginate --slurp "${repoPath}/reviews"`)).flat(),
    dismissReview: (id, message) => gh(`api "${repoPath}/reviews/${id}/dismissals" --method PUT --input -`, JSON.stringify({ message })),
    approve: payload => gh(`api "${repoPath}/reviews" --method POST --input -`, JSON.stringify(payload)),
  };
}

// Advisory like the rest of the review, so the caller logs a failure here and never fails the job on it.
function postInlineReview(prNumber, kept, ownDiff) {
  if (!REVIEW_INLINE) {
    console.log(`[${isoNow()}] REVIEW_INLINE=false; not posting inline comments`);
    return { posted: 0, skipped: "disabled" };
  }
  let posted = new Set();
  if (REVIEW_BOT_LOGIN) {
    const pages = JSON.parse(gh(`api --paginate --slurp "repos/${process.env.GITHUB_REPOSITORY}/pulls/${prNumber}/comments"`));
    posted = existingFingerprints(pages.flat(), REVIEW_BOT_LOGIN);
  }
  const { selected, dropped } = selectInlineComments(kept, rightSideLines(ownDiff), posted);
  console.log(`[${isoNow()}] Inline: ${selected.length} to post; dropped ${JSON.stringify(dropped)}`);
  if (selected.length === 0) return { posted: 0, dropped };
  const scrub = text => {
    const scrubbed = scrubReviewBody(redactIdentity(text), process.env);
    if (scrubbed.secretHits > 0) console.warn(`[${isoNow()}] Redacted ${scrubbed.secretHits} secret-shaped value(s) from an inline comment`);
    return scrubbed.text;
  };
  const summary = `${REVIEW_TITLE}: ${selected.length} finding(s) from the review comment, anchored to the diff.`;
  const payload = buildReviewPayload(selected, process.env.HEAD_SHA || "", summary, scrub);
  const tmpFile = `/tmp/review_inline_${randomUUID()}.json`;
  writeFileSync(tmpFile, JSON.stringify(payload));
  try {
    gh(`api "repos/${process.env.GITHUB_REPOSITORY}/pulls/${prNumber}/reviews" --method POST --input "${tmpFile}"`);
  } finally {
    try { unlinkSync(tmpFile); } catch {}
  }
  return { posted: selected.length, dropped };
}

// Model output only (parsed findings, no raw text, no prompts), scrubbed like the comment, for grading what the coordinator kept.
function writeFindingsArtifact(prNumber, tier, results, coordinatorResult, inlineResult, confidence, autoApprove) {
  if (!REVIEW_ARTIFACT_DIR) return;
  try {
    const clean = text => scrubSecrets(redactIdentity(text), process.env).text;
    const data = mapStrings({
      pr: String(prNumber),
      head_sha: process.env.HEAD_SHA || "",
      tier,
      reviewers: results.map(r => ({
        agent: r.agentKey,
        name: r.agentName,
        skipped: Boolean(r.skipped),
        parsed: r.parsed === true,
        error: r.error || null,
        findings: r.findings,
      })),
      coordinator: coordinatorResult
        ? { fallback: coordinatorResult.fallback, error: coordinatorResult.error, kept: coordinatorResult.kept || [] }
        : null,
      inline: inlineResult,
      merge_confidence: confidence,
      auto_approve: autoApprove,
    }, clean);
    mkdirSync(REVIEW_ARTIFACT_DIR, { recursive: true });
    writeFileSync(resolve(REVIEW_ARTIFACT_DIR, "review-findings.json"), `${JSON.stringify(data, null, 2)}\n`);
  } catch (err) {
    console.warn(`[${isoNow()}] Could not write the findings artifact: ${err.message}`);
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

    // Counted before the key check, so a misconfiguration notice keeps the PR's review count.
    const existingSpan = TRACE.startSpan("github.pr.existing_review_lookup", { "github.pr.number": prNumber }, rootSpan);
    const lookup = findExistingReviewComment(prNumber);
    const existingComment = lookup.comment;
    const passesDone = passesDoneIn(existingComment);
    TRACE.endSpan(existingSpan, {
      "github.pr.existing_review_found": Boolean(existingComment),
      "github.pr.existing_review_comment_id": existingComment?.id,
    });
    TRACE.setSpanAttributes(rootSpan, { "review.passes_done": passesDone, "review.max_passes": REVIEW_MAX_PASSES });
    if (!REVIEW_IGNORE_PASS_LIMIT && !lookup.ok) {
      outcome = "misconfigured";
      TRACE.setSpanAttributes(rootSpan, { "review.skipped": true, "review.skip_reason": "pass_count_unknown" });
      throw new Error("Cannot read this PR's review comments (no reviewer app token, or the comment list failed), so the reviewed commit and the review limit cannot be checked; not reviewing.");
    }
    const headKey = reviewKey(process.env.HEAD_SHA, PAIRED.head);
    const skipReason = reviewSkipReason({
      body: existingComment?.body,
      key: headKey,
      passesDone,
      maxPasses: REVIEW_MAX_PASSES,
      ignorePassLimit: REVIEW_IGNORE_PASS_LIMIT,
      forceFull: process.env.FORCE_FULL === "true",
    });
    const gate = createAutoApproveGate({
      mode: AUTO_APPROVE_MODE,
      api: githubReviewApi(prNumber),
      botLogin: REVIEW_BOT_LOGIN,
      headSha: process.env.HEAD_SHA,
      warn: message => console.warn(`[${isoNow()}] Auto-approve: ${message}`),
    });
    // Ahead of the cap skip too: a push the cap leaves unreviewed must still lose the earlier approval.
    if (skipReason !== "already_reviewed") gate.start();
    if (skipReason) {
      console.log(`[${isoNow()}] PR #${prNumber} skipped (${skipReason}): ${headKey || "no head"}, ${passesDone} review(s) so far. Dispatch the workflow with ignore_pass_limit to review again.`);
      if (skipReason === "pass_limit_reached") noteSkippedPush(prNumber, existingComment, headKey);
      else noteReviewedHead(prNumber, existingComment);
      outcome = "skipped";
      TRACE.setSpanAttributes(rootSpan, { "review.skipped": true, "review.skip_reason": skipReason });
      return;
    }

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
        if (existingComment) updateReviewComment(prNumber, existingComment.id, withPassTag(notice, passesDone));
        else postReviewComment(prNumber, withPassTag(notice, passesDone));
      } catch (postErr) {
        console.error(`[${isoNow()}] Also failed to post the misconfiguration notice: ${postErr.message}`);
      }
      throw new Error(message);
    }

    console.log(`[${isoNow()}] ${MODEL_SLUG} (via opencode serve): configured`);

    // 1. Get PR diff
    console.log(`[${isoNow()}] Fetching PR diff...`);
    let diff;
    // This repo's diff alone: inline comments can only anchor to files of this PR, not the paired one.
    let ownDiff;
    let diffPinned = false;
    const diffSpan = TRACE.startSpan("github.pr.diff", { "github.pr.number": prNumber }, rootSpan);
    try {
      ({ diff, own: ownDiff, pinned: diffPinned } = fetchPrDiff(prNumber));
      const diffStats = diff.split("\n").length;
      TRACE.endSpan(diffSpan, { "diff.raw_lines": diffStats });
      console.log(`[${isoNow()}] Raw diff: ${diffStats} lines`);
    } catch (err) {
      const detail = execErrorText(err);
      console.error(`Failed to fetch PR diff: ${detail}`);
      TRACE.endSpan(diffSpan, {}, err);
      noteUnreviewedHead(prNumber, existingComment, headKey);
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
      noteUnreviewedHead(prNumber, existingComment, headKey);
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
    // Only the full tier runs Security, which the auto-approve gate requires.
    const rawDiffFacts = parseRawDiff(diff);
    const gateNeedsFullTier = gate.active && sizeReasons(rawDiffFacts).length === 0;
    const tier = process.env.FORCE_FULL === "true" || gateNeedsFullTier ? "full" : assessRiskTier(filtered);
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
    let reviewedText = null;
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
      reviewedText = { title: prData.title, body: prData.body };
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
    if (existingComment) {
      if (isPlaceholderComment(existingComment.body)) {
        console.log(`[${isoNow()}] Replacing pointer/notice comment #${existingComment.id} with a review`);
      } else {
        existingReview = previousReviewText(existingComment.body);
        console.log(`[${isoNow()}] Re-review mode: found existing review comment #${existingComment.id}`);
      }
    }
    let existingCommentId = existingComment?.id ?? null;
    if (lookup.ok) {
      try {
        existingCommentId = claimReviewPass(prNumber, existingComment, passesDone + 1, headKey);
      } catch (err) {
        throw new Error(`Could not record the review pass, so the review count cannot be kept; not reviewing: ${execErrorText(err).slice(0, 300)}`);
      }
    }

    // 6. Run reviewers in parallel
    let impact = "";
    try {
      impact = buildImpactContext(filtered.diff, PR_DIR);
      console.log(`[${isoNow()}] Impact map: ${impact ? impact.split("\n").length : 0} lines`);
    } catch (err) {
      console.warn(`[${isoNow()}] Impact map skipped: ${err.message}`);
    }
    const agentsToRun = selectedAgents;
    console.log(`[${isoNow()}] Launching ${agentsToRun.length} reviewers in parallel...`);

    const agentResults = await Promise.allSettled(
      agentsToRun.map(agentKey => {
        const def = AGENTS[agentKey];
        if (!def) return Promise.resolve({ agentKey, agentName: agentKey, findings: [], error: `Unknown agent: ${agentKey}`, genAIResponseId: "" });
        return runReviewer(agentKey, def, filtered.diff, prContext, existingReview, rootSpan, impact, gateNeedsFullTier);
      }),
    );

    const results = agentResults.map(r => r.status === "fulfilled" ? r.value : { agentKey: "unknown", agentName: "unknown", findings: [], error: r.reason?.message || "Unknown error", genAIResponseId: "" });
    const totalFindings = results.reduce((sum, r) => sum + r.findings.length, 0);
    // A requiresFocus agent that saw no files in its domain opted out — it is neither expected
    // nor completed, so it must not count toward coverage.
    const ranResults = results.filter(r => !r.skipped);
    // Free-form output is no review, so it counts as a failure everywhere a clean exit would otherwise read as finished.
    const failedAgents = ranResults.filter(r => r.error || r.parsed !== true);
    const completedAgents = ranResults.filter(r => !r.error && r.parsed === true);
    const failedAgentNames = failedAgents.map(r => r.agentName);
    const failureReasons = Object.fromEntries(
      failedAgents.map(r => [r.agentName, r.error || UNPARSEABLE_OUTPUT]),
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
    // If EVERY reviewer failed or returned nothing parseable there are no findings to consolidate, so the coordinator can
    // only produce "no issues found" — which reads as an approval on a PR that was never
    // actually reviewed. That is strictly worse than posting nothing: it is a green light
    // manufactured from a total outage. Report the failure instead, skip the coordinator
    // (saving another AGENT_TIMEOUT_MS of waiting on a provider that is already failing),
    // and exit non-zero so the check surfaces as red.
    const allAgentsFailed = ranResults.length > 0 && failedAgents.length === ranResults.length;
    let finalReview;
    let coordinatorResult = null;
    let responseIds = reviewerResponseIds;

    if (allAgentsFailed) {
      outcome = "all_agents_failed";
      exitCode = 1;
      const detail = failedAgents
        .map(r => `- ${r.agentName}: ${r.error || UNPARSEABLE_OUTPUT}`)
        .join("\n");
      console.error(`[${isoNow()}] All ${ranResults.length} reviewers failed — skipping coordinator and reporting failure.`);
      TRACE.setSpanAttributes(rootSpan, {
        "review.all_agents_failed": true,
        "review.coordinator_skipped": true,
      });
      const partial = partialFindingsBlock(results);
      finalReview = [
        REVIEW_HEADING,
        ``,
        `> [!CAUTION]`,
        `> ### ⛔ Not reviewed`,
        `> All ${ranResults.length} reviewers failed, so ${partial ? "the findings below are incomplete" : "there are no findings to report"} — this is an infrastructure failure, not an approval.`,
        ``,
        ...(partial ? [partial, ``] : []),
        `<details>`,
        `<summary>🧾 Reviewer failures (${failedAgents.length})</summary>`,
        ``,
        detail,
        ``,
        `</details>`,
      ].join("\n");
    } else {
      coordinatorResult = await runCoordinator(results, prContext, tier, existingReview, rootSpan);
      finalReview = insertAfterCallout(coordinatorResult.text, failedReviewersNote(failedAgents, ranResults.length));
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

    const confidence = mergeConfidence({
      counts: severityCounts(coordinatorResult?.kept ?? []),
      findingsKnown: Boolean(coordinatorResult?.findingsKnown),
      failedReviewers: unfinishedReviewers(ranResults),
      ranCount: ranResults.length,
      coordinatorFallback: Boolean(coordinatorResult?.fallback),
      ...changedCodeEvidence(filtered.diff, PAIRED.dir),
    });
    TRACE.setSpanAttributes(rootSpan, {
      "gen_ai.response.ids": responseIds,
      "gen_ai.response.count": responseIds.length,
      "review.merge_confidence": confidence.level,
    });

    // Ahead of the gate, which must judge what gets posted: the sanitizer can discard the callout the model led with.
    const sanitizeSpan = TRACE.startSpan("ai_review.sanitize", {}, rootSpan);
    const sanitizedReview = sanitizeForPosting(finalReview);
    TRACE.endSpan(sanitizeSpan, { "review.sanitized_length": sanitizedReview.length });

    // Decided before the comment is written so the line can state what really happened; a failed approval never fails the job.
    const autoApprove = gate.conclude({
      diff: rawDiffFacts,
      diffPinned,
      reviewedText,
      reviewConfig: OPENCODE_CONFIG.name,
      filteredFileCount: filtered.files.length,
      reviewedChars: prContext.length + filtered.diff.length,
      confidence,
      counts: severityCounts(coordinatorResult?.kept ?? []),
      reviewerFindingCount: totalFindings,
      findingsKnown: Boolean(coordinatorResult?.findingsKnown),
      coordinatorFallback: Boolean(coordinatorResult?.fallback),
      decisionApproved: isApprovedReview(sanitizedReview),
      reviewers: reviewerFacts(results),
      paired: Boolean(PAIRED.repo || PAIRED.prNumber || PAIRED.head),
      pairClear: REVIEW_PAIR_CLEAR,
    });
    if (autoApprove) {
      console.log(`[${isoNow()}] Auto-approve (${autoApprove.mode}): eligible=${autoApprove.eligible} approved=${autoApprove.approved} ${autoApprove.reasons.join("; ")}`);
      TRACE.setSpanAttributes(rootSpan, {
        "review.auto_approve.mode": autoApprove.mode,
        "review.auto_approve.eligible": autoApprove.eligible,
        "review.auto_approve.eligible_ignoring_config": autoApprove.eligible_ignoring_config,
        "review.auto_approve.approved": autoApprove.approved,
        "review.auto_approve.reasons": autoApprove.reasons,
      });
    }

    // Written now so a failed post still leaves the findings behind; rewritten with the inline outcome below.
    writeFindingsArtifact(prNumber, tier, results, coordinatorResult, null, confidence, autoApprove);

    // A run where no reviewer finished reviewed nothing, so it does not use up a pass.
    const reviewed = completedAgents.length > 0;
    const passes = reviewed ? passesDone + 1 : passesDone;
    if (reviewed && !diffPinned) console.warn(`[${isoNow()}] The reviewed diff is not tied to ${headKey}, so the commit stays reviewable`);
    finalReview = finishReviewBody(sanitizedReview, { key: headKey, passes, maxPasses: REVIEW_MAX_PASSES, reviewed: reviewed && diffPinned, confidence, gateLine: autoApproveLine(autoApprove) });
    TRACE.setSpanAttributes(rootSpan, { "review.final_length": finalReview.length });
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

    let inlineResult = null;
    if (coordinatorResult) {
      const inlineSpan = TRACE.startSpan("github.pr.inline_review", { "github.pr.number": prNumber }, rootSpan);
      try {
        inlineResult = postInlineReview(prNumber, coordinatorResult.kept, ownDiff);
        TRACE.endSpan(inlineSpan, { "review.inline.posted": inlineResult.posted });
      } catch (err) {
        console.warn(`[${isoNow()}] Could not post inline comments: ${execErrorText(err).slice(0, 300)}`);
        inlineResult = { posted: 0, error: "post failed" };
        TRACE.endSpan(inlineSpan, {}, err);
      }
    }
    writeFindingsArtifact(prNumber, tier, results, coordinatorResult, inlineResult, confidence, autoApprove);

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
