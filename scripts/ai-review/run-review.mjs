import { execSync } from "node:child_process";
import { readFileSync, existsSync, writeFileSync, unlinkSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";

const __dirname = dirname(fileURLToPath(import.meta.url));

const REVIEW_MARKER = "<!-- ai-code-review -->";
const MAX_DIFF_TOKENS = 150_000;
const AGENT_TIMEOUT_MS = 5 * 60 * 1000;
const OVERALL_TIMEOUT_MS = 20 * 60 * 1000;

// ─── Noise patterns ────────────────────────────────────────────────────────
const NOISE_FILES = [
  "bun.lock", "package-lock.json", "yarn.lock", "pnpm-lock.yaml",
  "Cargo.lock", "go.sum", "poetry.lock", "Pipfile.lock", "flake.lock",
  ".gitignore", "deny.toml",
];
const NOISE_EXTENSIONS = [".min.js", ".min.css", ".bundle.js", ".map", ".svg"];
const NOISE_GENERATED_MARKERS = ["@generated", "auto-generated", "DO NOT EDIT", "Generated file"];

// ─── Agent definitions ─────────────────────────────────────────────────────
const AGENTS = {
  security: {
    name: "Security Reviewer",
    promptFile: "agents/security.md",
    model: "claude-sonnet-4-20250514",
    modelFamily: "anthropic",
    failbackFamily: "deepseek",
    failbackModel: "deepseek-chat",
    fileFocus: f => /\.rs$|\.toml$|auth|authz|oauth|token|crypto|secret|password|unsafe/.test(f),
  },
  "code-quality": {
    name: "Code Quality Reviewer",
    promptFile: "agents/code-quality.md",
    model: "deepseek-chat",
    modelFamily: "deepseek",
    failbackFamily: "anthropic",
    failbackModel: "claude-sonnet-4-20250514",
    fileFocus: f => /\.rs$|\.ts$|\.vue$|\.js$/.test(f),
  },
  performance: {
    name: "Performance Reviewer",
    promptFile: "agents/performance.md",
    model: "claude-sonnet-4-20250514",
    modelFamily: "anthropic",
    failbackFamily: "deepseek",
    failbackModel: "deepseek-chat",
    fileFocus: f => /\.rs$|\.ts$|\.vue$|\.sql$/.test(f),
  },
  documentation: {
    name: "Documentation Reviewer",
    promptFile: "agents/documentation.md",
    model: "deepseek-chat",
    modelFamily: "deepseek",
    failbackFamily: "anthropic",
    failbackModel: "claude-sonnet-4-20250514",
    fileFocus: () => true,
  },
  release: {
    name: "Release Reviewer",
    promptFile: "agents/release.md",
    model: "deepseek-chat",
    modelFamily: "deepseek",
    failbackFamily: "anthropic",
    failbackModel: "claude-sonnet-4-20250514",
    fileFocus: f => /Cargo\.toml|package\.json|\.sql$|migration|Migration|\.yml$|Dockerfile|docker/.test(f),
  },
};

// ─── Risk tiers ────────────────────────────────────────────────────────────
const RISK_TIERS = {
  trivial: {
    maxLines: 10,
    maxFiles: 20,
    agents: ["code-quality"],
    coordinatorModel: "deepseek-chat",
  },
  lite: {
    maxLines: 100,
    maxFiles: 20,
    agents: ["code-quality", "documentation"],
    coordinatorModel: "claude-sonnet-4-20250514",
  },
  full: {
    agents: ["security", "code-quality", "performance", "documentation", "release"],
    coordinatorModel: "claude-sonnet-4-20250514",
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

function readPrompt(name) {
  const path = resolve(__dirname, name);
  if (!existsSync(path)) return "";
  return readFileSync(path, "utf-8").trim();
}

function isoNow() {
  return new Date().toISOString();
}

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

// ─── LLM calls ─────────────────────────────────────────────────────────────

async function callAnthropic(systemPrompt, userPrompt, model, timeoutMs = AGENT_TIMEOUT_MS) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY not set");

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const resp = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model,
        max_tokens: 4096,
        temperature: 0.0,
        system: systemPrompt.slice(0, 100_000),
        messages: [{ role: "user", content: userPrompt.slice(0, 150_000) }],
      }),
      signal: controller.signal,
    });

    if (!resp.ok) {
      const err = await resp.text();
      throw new Error(`Anthropic API error ${resp.status}: ${err.slice(0, 500)}`);
    }

    const data = await resp.json();
    return data.content?.[0]?.text || "";
  } finally {
    clearTimeout(timer);
  }
}

async function callDeepSeek(systemPrompt, userPrompt, model, timeoutMs = AGENT_TIMEOUT_MS) {
  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (!apiKey) throw new Error("DEEPSEEK_API_KEY not set");

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const resp = await fetch("https://api.deepseek.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: model || "deepseek-chat",
        messages: [
          { role: "system", content: systemPrompt.slice(0, 100_000) },
          { role: "user", content: userPrompt.slice(0, 150_000) },
        ],
        temperature: 0.0,
        max_tokens: 8192,
      }),
      signal: controller.signal,
    });

    if (!resp.ok) {
      const err = await resp.text();
      throw new Error(`DeepSeek API error ${resp.status}: ${err.slice(0, 500)}`);
    }

    const data = await resp.json();
    return data.choices?.[0]?.message?.content || "";
  } finally {
    clearTimeout(timer);
  }
}

async function callLLM(modelFamily, systemPrompt, userPrompt, model, timeoutMs) {
  if (modelFamily === "anthropic") {
    return callAnthropic(systemPrompt, userPrompt, model, timeoutMs);
  }
  if (modelFamily === "deepseek") {
    return callDeepSeek(systemPrompt, userPrompt, model, timeoutMs);
  }
  throw new Error(`Unknown model family: ${modelFamily}`);
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

async function runReviewer(agentKey, agentDef, diff, prContext, existingReview) {
  let modelFamily = agentDef.modelFamily;
  let model = agentDef.model;

  const hasKey = (family) => {
    if (family === "anthropic") return Boolean(process.env.ANTHROPIC_API_KEY);
    if (family === "deepseek") return Boolean(process.env.DEEPSEEK_API_KEY);
    return false;
  };

  if (!hasKey(modelFamily) && agentDef.failbackFamily && hasKey(agentDef.failbackFamily)) {
    console.log(`[${isoNow()}] ${agentDef.name}: ${modelFamily} not available, failing back to ${agentDef.failbackFamily}/${agentDef.failbackModel}`);
    modelFamily = agentDef.failbackFamily;
    model = agentDef.failbackModel;
  }

  if (!hasKey(modelFamily)) {
    console.log(`[${isoNow()}] ${agentDef.name}: SKIPPED — no API key for ${modelFamily}`);
    return { agentKey, agentName: agentDef.name, findings: [], rawText: "", error: `No API key for ${modelFamily}` };
  }

  const systemPrompt = readPrompt("shared-rules.md");
  const agentPrompt = readPrompt(agentDef.promptFile);
  if (!agentPrompt) throw new Error(`Missing agent prompt: ${agentDef.promptFile}`);

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

  console.log(`[${isoNow()}] Starting ${agentDef.name} (${modelFamily}/${model})`);
  const start = Date.now();

  try {
    const text = await callLLM(
      modelFamily,
      fullSystem,
      userPrompt,
      model,
      AGENT_TIMEOUT_MS,
    );
    const elapsed = ((Date.now() - start) / 1000).toFixed(1);
    console.log(`[${isoNow()}] ${agentDef.name} completed in ${elapsed}s`);

    const findings = parseFindings(text);
    if (findings.length === 0 && !text.includes("no-issues") && !text.includes("LGTM")) {
      console.log(`[${isoNow()}] ${agentDef.name}: No structured findings found, checking for no-issues marker`);
      console.log(`[${isoNow()}] ${agentDef.name} raw output (first 500 chars): ${text.slice(0, 500)}`);
    } else {
      console.log(`[${isoNow()}] ${agentDef.name}: ${findings.length} findings`);
    }

    return { agentKey, agentName: agentDef.name, findings, rawText: text, error: null };
  } catch (err) {
    const elapsed = ((Date.now() - start) / 1000).toFixed(1);
    console.error(`[${isoNow()}] ${agentDef.name} FAILED after ${elapsed}s: ${err.message}`);
    return { agentKey, agentName: agentDef.name, findings: [], rawText: "", error: err.message };
  }
}

// ─── Coordinator pass ─────────────────────────────────────────────────────

async function runCoordinator(agentResults, prContext, tier, existingReview) {
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
  let coordinatorModel = tierConfig.coordinatorModel || "claude-sonnet-4-20250514";
  let modelFamily = coordinatorModel.startsWith("claude") ? "anthropic" : "deepseek";

  // Coordinator failback
  const hasKey = (family) => family === "anthropic" ? Boolean(process.env.ANTHROPIC_API_KEY) : Boolean(process.env.DEEPSEEK_API_KEY);
  if (!hasKey(modelFamily)) {
    const fallbackFamily = modelFamily === "anthropic" ? "deepseek" : "anthropic";
    const fallbackModel = fallbackFamily === "deepseek" ? "deepseek-chat" : "claude-sonnet-4-20250514";
    if (hasKey(fallbackFamily)) {
      console.log(`[${isoNow()}] Coordinator: ${modelFamily}/${coordinatorModel} not available, failing back to ${fallbackFamily}/${fallbackModel}`);
      modelFamily = fallbackFamily;
      coordinatorModel = fallbackModel;
    } else {
      return buildFallbackReview(agentResults, tier, []);
    }
  }

  console.log(`[${isoNow()}] Running coordinator (${coordinatorModel})`);
  try {
    const text = await callLLM(modelFamily, `${sharedRules}\n\n${coordinatorPrompt}`, userPrompt, coordinatorModel);
    return text;
  } catch (err) {
    console.error(`[${isoNow()}] Coordinator failed: ${err.message}`);
    return buildFallbackReview(agentResults, tier, failedAgents);
  }
}

function buildFallbackReview(agentResults, tier, failedAgents) {
  const allFindings = agentResults.flatMap(r => r.findings);
  if (allFindings.length === 0) {
    return `${REVIEW_MARKER}
## AI Code Review

### Decision: approved

LGTM — No issues found by automated reviewers.

<details>
<summary>Review Details</summary>
- Risk tier: ${tier}
- Failed reviewers: ${failedAgents.length > 0 ? failedAgents.map(r => r.agentName).join(", ") : "none"}
</details>`;
  }

  const byCategory = {};
  for (const f of allFindings) {
    (byCategory[f.category] ||= []).push(f);
  }

  const sections = [];
  for (const [cat, findings] of Object.entries(byCategory)) {
    sections.push(`### ${cat.charAt(0).toUpperCase() + cat.slice(1)}`);
    for (const f of findings) {
      sections.push(`- **${f.severity.toUpperCase()}** — \`${f.file}:${f.line}\` — ${f.summary}`);
    }
  }

  return `${REVIEW_MARKER}
## AI Code Review

### Decision: approved_with_comments

Automated review — coordinator pass skipped due to error. Findings below are un-deduplicated.

${sections.join("\n")}

<details>
<summary>Review Details</summary>
- Risk tier: ${tier}
- Failed reviewers: ${failedAgents.length > 0 ? failedAgents.map(r => r.agentName).join(", ") : "none"}
- Note: Coordinator consolidation was skipped — findings may contain duplicates
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
  const payload = JSON.stringify({ body });
  const tmpFile = `/tmp/review_comment_${randomUUID()}.json`;
  writeFileSync(tmpFile, payload);
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
  if (!prNumber) {
    console.error("PR_NUMBER environment variable is required");
    process.exit(1);
  }

  console.log(`[${isoNow()}] AI Code Review started for PR #${prNumber}`);
  console.log(`[${isoNow()}] Repository: ${process.env.GITHUB_REPOSITORY}`);

  const hasAnthropic = Boolean(process.env.ANTHROPIC_API_KEY);
  const hasDeepSeek = Boolean(process.env.DEEPSEEK_API_KEY);
  if (!hasAnthropic && !hasDeepSeek) {
    console.error("No API keys configured. Set ANTHROPIC_API_KEY and/or DEEPSEEK_API_KEY secrets.");
    process.exit(1);
  }
  console.log(`[${isoNow()}] Anthropic: ${hasAnthropic ? "configured" : "MISSING"}, DeepSeek: ${hasDeepSeek ? "configured" : "MISSING"}`);

  // 1. Get PR diff
  console.log(`[${isoNow()}] Fetching PR diff...`);
  let diff;
  try {
    diff = gh(`pr diff "${prNumber}"`);
  } catch {
    console.error("Failed to fetch PR diff");
    process.exit(1);
  }

  const diffStats = diff.split("\n").length;
  console.log(`[${isoNow()}] Raw diff: ${diffStats} lines`);

  // 2. Filter diff
  const filtered = filterDiff(diff);
  console.log(`[${isoNow()}] Filtered diff: ${filtered.totalAdded + filtered.totalRemoved} changed lines across ${filtered.files.length} files`);
  console.log(`[${isoNow()}] Skipped ${parseDiffFiles(diff).length - filtered.files.length} noise files`);

  if (filtered.totalAdded + filtered.totalRemoved === 0) {
    console.log("No meaningful changes to review after filtering. Skipping.");
    return;
  }

  // 3. Assess risk tier
  let tier = process.env.FORCE_FULL === "true" ? "full" : assessRiskTier(filtered);
  const tierConfig = RISK_TIERS[tier] || RISK_TIERS.full;
  console.log(`[${isoNow()}] Risk tier: ${tier} → agents: [${tierConfig.agents.join(", ")}]`);

  // 4. PR context
  let prContext = `PR #${prNumber} in ${process.env.GITHUB_REPOSITORY}`;
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
  } catch {
    // fallback
  }

  // 5. Check for existing review (re-review mode)
  let existingReview = null;
  let existingCommentId = null;
  const existingComment = findExistingReviewComment(prNumber);
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
      if (!def) return Promise.resolve({ agentKey, agentName: agentKey, findings: [], error: `Unknown agent: ${agentKey}` });
      return runReviewer(agentKey, def, filtered.diff, prContext, existingReview);
    }),
  );

  const results = agentResults.map(r => r.status === "fulfilled" ? r.value : { agentKey: "unknown", agentName: "unknown", findings: [], error: r.reason?.message || "Unknown error" });
  const totalFindings = results.reduce((sum, r) => sum + r.findings.length, 0);
  const failedAgents = results.filter(r => r.error);
  console.log(`[${isoNow()}] All reviewers complete. Total findings: ${totalFindings}, Failures: ${failedAgents.length}`);

  // 7. Coordinator pass
  const finalReview = await runCoordinator(results, prContext, tier, existingReview);

  // 8. Post or update review
  if (existingCommentId) {
    console.log(`[${isoNow()}] Updating existing review comment #${existingCommentId}`);
    updateReviewComment(existingCommentId, finalReview);
  } else {
    console.log(`[${isoNow()}] Posting new review comment`);
    postReviewComment(prNumber, finalReview);
  }

  console.log(`[${isoNow()}] AI Code Review complete for PR #${prNumber}`);
}

// ─── Entry point ───────────────────────────────────────────────────────────

const startTime = Date.now();
const timeout = setTimeout(() => {
  console.error(`[${isoNow()}] Overall timeout (${OVERALL_TIMEOUT_MS / 1000}s) reached. Exiting.`);
  process.exit(1);
}, OVERALL_TIMEOUT_MS);

main()
  .then(() => {
    clearTimeout(timeout);
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log(`[${isoNow()}] Total execution time: ${elapsed}s`);
  })
  .catch(err => {
    clearTimeout(timeout);
    console.error(`[${isoNow()}] Fatal error:`, err);
    process.exit(1);
  });
