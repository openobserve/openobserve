import { REVIEW_HEADING } from "./comments.mjs";
import { reviewerFinished, shortName } from "./confidence.mjs";
import { SEVERITIES, SEVERITY_CAPS, normalizeSeverity, severityRank } from "./severity.mjs";

export { insertAfterCallout } from "./comments.mjs";

const MAX_FALLBACK_FINDINGS = 15;
const NO_ISSUES_RE = /<no-issues(?:\s[^<>]*)?>[\s\S]*?<\/no-issues>|<no-issues(?:\s[^<>]*)?\/>/;
const FINDING_BLOCK_RE = /<finding>([\s\S]*?)<\/finding>/g;
const SEVERITY_GLYPH = { p0: "🔴", p1: "🟠", p2: "🟡", p3: "🔵" };
const SEVERITY_SECTION = {
  p0: "#### 🔴 P0 · Blockers",
  p1: "#### 🟠 P1 · Blockers",
  p2: "#### 🟡 P2 · Should fix",
  p3: "#### 🔵 P3 · Worth a look",
};
// Cosmetic only: matches the coordinator's happy-path finding lines.
const CATEGORY_GLYPH = {
  security: "🔒",
  performance: "⚡",
  correctness: "🐞",
  "code-quality": "🧩", "code quality": "🧩", quality: "🧩",
  documentation: "📝", docs: "📝",
  release: "📦",
  frontend: "🎨", ui: "🎨",
  qa: "🧪", test: "🧪",
};

function failureReason(result) {
  if (result.timedOut || /timed out|TimeoutError/i.test(result.error || "")) return "timed out";
  return "failed";
}

// Written by code, never by the coordinator: a reader must always learn that an area went unreviewed.
export function failedReviewersNote(failed, ranCount) {
  if (!failed.length) return "";
  const detail = failed.map(r => `${shortName(r.agentName)}: ${failureReason(r)}`).join(", ");
  const tail = failed.length === 1 ? "its area was not reviewed" : "their areas were not reviewed";
  return `> ⚠️ ${failed.length} of ${ranCount} reviewers did not finish (${detail}); ${tail}.`;
}

// Applies `clean` to every string in a JSON-shaped value; used to scrub the findings artifact field by field.
export function mapStrings(value, clean) {
  if (typeof value === "string") return clean(value);
  if (Array.isArray(value)) return value.map(v => mapStrings(v, clean));
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, mapStrings(v, clean)]));
  }
  return value;
}

export function parseFindings(xmlText) {
  const findings = [];
  for (const [, block] of String(xmlText ?? "").matchAll(FINDING_BLOCK_RE)) {
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
      findings.push({ ...finding, severity: normalizeSeverity(finding.severity) });
    }
  }
  return findings;
}

// Scanned outside the finished blocks, so a `<finding>` quoted inside one is not an opener; like an unclosed inline block, an opener left over means text was lost.
function outputCutOff(text) {
  const rest = text.replace(FINDING_BLOCK_RE, "");
  const unclosed = (rest.match(/<findings\b/g)?.length ?? 0) > (rest.match(/<\/findings>/g)?.length ?? 0);
  return unclosed || /<finding\b/.test(rest) || rest.lastIndexOf("<findings") > rest.lastIndexOf("</findings>");
}

// "No findings" must be stated in full: empty, free-form or cut-off output is a reviewer that said nothing, not one that found nothing, and an unread block could be the blocker.
export function reviewerReported(text, findings) {
  const output = String(text ?? "");
  if (outputCutOff(output) || (output.match(FINDING_BLOCK_RE)?.length ?? 0) !== findings.length) return false;
  return findings.length > 0 || NO_ISSUES_RE.test(output);
}

// Same shape as an entry of the coordinator's inline block.
export function toKeptFinding(f) {
  return {
    file: (f.file || "").replace(/^\.?\//, ""),
    line: Number.parseInt(f.line, 10) || 0,
    severity: normalizeSeverity(f.severity),
    category: f.category || "",
    title: f.summary,
    body: [f.description, f.suggestion ? `**Fix:** ${f.suggestion}` : ""].filter(Boolean).join("\n\n"),
  };
}

function dedupeFindings(agentResults) {
  const seen = new Map();
  const deduped = [];
  for (const f of agentResults.flatMap(r => r.findings)) {
    const key = `${(f.category || "").toLowerCase()}|${(f.summary || "").toLowerCase().slice(0, 120)}`;
    const existing = seen.get(key);
    if (!existing) {
      seen.set(key, { ...f });
      deduped.push(seen.get(key));
    } else if (severityRank(f.severity) < severityRank(existing.severity)) {
      existing.severity = f.severity;
      existing.description = f.description || existing.description;
      existing.suggestion = f.suggestion || existing.suggestion;
      existing.file = f.file || existing.file;
      existing.line = f.line || existing.line;
    }
  }
  return deduped;
}

// The caps apply here so the fallback comment and its inline threads list the same findings.
export function selectFallbackFindings(agentResults) {
  const counts = {};
  const ranked = dedupeFindings(agentResults).sort((a, b) => severityRank(a.severity) - severityRank(b.severity));
  const kept = ranked.filter(f => {
    const severity = normalizeSeverity(f.severity);
    counts[severity] = (counts[severity] || 0) + 1;
    return counts[severity] <= (SEVERITY_CAPS[severity] ?? Infinity);
  });
  // Ranked, so the cap only ever reaches past the blockers it must not drop.
  return kept.filter((f, i) => i < MAX_FALLBACK_FINDINGS || !(normalizeSeverity(f.severity) in SEVERITY_CAPS));
}

function severityCountLine(counts) {
  const parts = SEVERITIES.map(s => `${SEVERITY_GLYPH[s]} ${s.toUpperCase()}: ${counts[s] ?? 0}`);
  return `**${parts.join(" · ")}**`;
}

function fallbackFindingLine(f) {
  const glyph = CATEGORY_GLYPH[(f.category || "").toLowerCase()] || "•";
  const loc = f.file && f.line && f.line !== "0" ? `\`${f.file}:${f.line}\` ` : f.file ? `\`${f.file}\` ` : "";
  // The sanitizer keeps a line it can read as a finding, so the tag is always present and cannot close early.
  const category = (f.category || "general").replace(/[\]\n]+/g, " ");
  const cat = `**[${category.charAt(0).toUpperCase() + category.slice(1)}]** `;
  const fix = f.suggestion ? ` (→ ${f.suggestion})` : "";
  return `- ${glyph} ${loc}${cat}${f.summary}${fix}`;
}

function fallbackDedupNote(rawCount, uniqueCount, shownCount) {
  const deduped = rawCount > uniqueCount
    ? ` Deduplicated: ${rawCount} raw findings → ${uniqueCount} unique (${rawCount - uniqueCount} duplicates removed).`
    : "";
  const capped = uniqueCount > shownCount ? ` Showing the ${shownCount} most severe.` : "";
  return deduped || capped ? `\n>${deduped}${capped}` : "";
}

function groupBySeverity(findings) {
  return Object.fromEntries(SEVERITIES.map(s => [s, findings.filter(f => normalizeSeverity(f.severity) === s)]));
}

function severitySections(bySeverity) {
  return SEVERITIES
    .filter(s => bySeverity[s].length > 0)
    .flatMap(s => [SEVERITY_SECTION[s], ...bySeverity[s].map(fallbackFindingLine), ""]);
}

// A cut-off report still holds finished findings, and a blocker must not vanish because the run failed.
export function partialFindingsBlock(agentResults) {
  const shown = selectFallbackFindings(agentResults);
  if (shown.length === 0) return "";
  return `<details open>\n<summary>📋 Findings so far (${shown.length})</summary>\n\n${severitySections(groupBySeverity(shown)).join("\n")}\n</details>`;
}

export function buildFallbackReview(agentResults, tier, failedAgents, marker) {
  const shown = selectFallbackFindings(agentResults);
  const failedLine = failedAgents.length > 0 ? `- Failed reviewers: ${failedAgents.map(r => r.agentName).join(", ")}` : "";

  if (shown.length === 0) {
    return `${marker}
${REVIEW_HEADING}

> [!TIP]
> ### ✅ Approved
> LGTM — No issues found by automated reviewers.

${severityCountLine({})}

<details>
<summary>🧾 Review details</summary>

- Risk tier: ${tier}
${failedLine}

</details>`;
  }

  const bySeverity = groupBySeverity(shown);
  const sections = severitySections(bySeverity);
  const blocked = bySeverity.p0.length + bySeverity.p1.length > 0;
  const callout = blocked ? "> [!CAUTION]\n> ### ⛔ Blockers found" : "> [!NOTE]\n> ### 💬 Approved with comments";
  const rawCount = agentResults.flatMap(r => r.findings).length;
  const dedupNote = fallbackDedupNote(rawCount, dedupeFindings(agentResults).length, shown.length);

  return `${marker}
${REVIEW_HEADING}

${callout}
> Automated review — ${failedAgents.length > 0 ? "some reviewers failed and " : ""}coordinator consolidation was skipped. Findings below are deduplicated but un-judged.${dedupNote}

${severityCountLine(Object.fromEntries(SEVERITIES.map(s => [s, bySeverity[s].length])))}

<details open>
<summary>📋 Show findings (${shown.length})</summary>

${sections.join("\n")}

---

- Risk tier: ${tier}
- Reviewers completed: ${agentResults.filter(reviewerFinished).map(r => r.agentName).join(", ") || "none"}
${failedLine}

</details>`;
}
