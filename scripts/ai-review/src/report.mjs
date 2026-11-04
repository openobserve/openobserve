import { REVIEW_HEADING } from "./comments.mjs";
import { reviewerFinished, shortName } from "./confidence.mjs";
import { SEVERITIES, SEVERITY_CAPS, normalizeSeverity, severityRank } from "./severity.mjs";

export { insertAfterCallout } from "./comments.mjs";

const MAX_FALLBACK_FINDINGS = 15;
const NEARBY_LINES = 5;
const NO_ISSUES_RE = /<no-issues(?:\s[^<>]*)?>[\s\S]*?<\/no-issues>|<no-issues(?:\s[^<>]*)?\/>/;
const FINDING_BLOCK_RE = /<finding>([\s\S]*?)<\/finding>/g;
const FINDING_PLACEHOLDER = "\u0000finding\u0000";
// Prose outside the report that admits the review did not happen; a false hit only costs the area its "finished" mark.
const INABILITY_RE = /\b(?:could ?n[o']t|can ?n[o']t|can't|unable to|was ?n[o']t able|were ?n[o']t able|failed to|no access|do(?:es)? ?n[o']t have access|did ?n[o']t have access|not able to)\b/i;
// Inside a no-issues body only an inability to see the inputs or do the review counts: "could not find any problem" or "could not run the tests" is a clean result.
const CANNOT = String.raw`\b(?:could ?n[o']t|couldn't|can ?n[o']t|can't|unable to|(?:was|were) ?n[o']t able to|wasn't able to|weren't able to|not able to|failed to)\s+(?:(?:fully|actually|properly|successfully|even|really)\s+)?(?:(?:[\w'-]+\s+){1,5}?(?:or|and|nor)\s+(?:also\s+)?)?`;
const INPUT_NOUN = String.raw`\b(?:files?|diffs?|patch(?:es)?|repo(?:sitory)?|PR|pull request|code|changes|sources?|hunks?|commits?|contents?)\b`;
const REVIEW_INABILITY_RE = new RegExp([
  String.raw`${CANNOT}(?:read|access|inspect|review|examine|analy[sz]e|view)(?![\w-])`,
  String.raw`${CANNOT}(?:open|load|fetch|retrieve|get|obtain)\b[^.;:!?\n]{0,40}?${INPUT_NOUN}`,
  String.raw`${CANNOT}(?:perform|complete|finish|do|conduct|carry out)\b[^.;:!?\n]{0,30}?\b(?:review|analysis)\b`,
  String.raw`\bno access\b|\b(?:do|does|did) ?n[o']t have access\b|\b(?:don't|doesn't|didn't) have access\b|\bwithout access\b`,
  String.raw`\btools? (?:call )?(?:failed|errored|was unavailable|is unavailable)\b`,
].join("|"), "i");
// Typographic apostrophes and broken spacing would otherwise slip a contraction past the inability patterns.
const APOSTROPHE_RE = /[\u2018\u2019\u02BC\u2032\uFF07]/g;
const FENCE_RE = /(```|~~~)[\s\S]*?(?:\1|$)/g;
const BLOCKQUOTE_LINE_RE = /^[ \t]*>.*$/gm;
const SEVERITY_GLYPH = { p0: "🔴", p1: "🟠", p2: "🟡", p3: "🔵" };
const SEVERITY_SECTION = {
  p0: "#### 🔴 P0 · Blockers",
  p1: "#### 🟠 P1 · Major concerns",
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

function plainProse(text) {
  return text.replace(APOSTROPHE_RE, "'").replace(/\s+/g, " ");
}

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

// A fence holding nothing but the report is a formatting habit; anything else around the fence makes it a quoted example.
function unwrapWholeFence(text) {
  const m = text.match(/^\s*(```|~~~)[\w-]*[ \t]*\n([\s\S]*?)\n?[ \t]*\1\s*$/);
  return m && !m[2].includes(m[1]) ? m[2] : text;
}

function quotesReportInFence(text) {
  return [...text.matchAll(FENCE_RE)].some(([fence]) => /<\/?findings\b|<no-issues\b|<finding\b/.test(fence));
}

// Neither a renderer nor a reader sees a report inside code or a comment, so it cannot be the answer.
function withoutQuotedText(text) {
  return text.replace(FENCE_RE, "").replace(/(`+)[\s\S]*?\1|`/g, "");
}

// Finding blocks become placeholders first, so code a finding quotes cannot hide its closing tag.
function hasReport(outside, findingCount) {
  // A blockquoted report is a quoted example; its prose still counts toward the inability checks.
  return [...withoutQuotedText(outside).replace(BLOCKQUOTE_LINE_RE, "").matchAll(/<findings(?:\s[^<>]*)?>([\s\S]*?)<\/findings>/g)]
    .some(([, body]) => (findingCount > 0 ? body.includes(FINDING_PLACEHOLDER) : NO_ISSUES_RE.test(body)));
}

// "No findings" must be stated in full, inside the <findings> wrapper the prompt asks for: empty, free-form, quoted or cut-off output is a reviewer that said nothing, not one that found nothing, and an unread block could be the blocker.
export function reviewerReported(text, findings) {
  const output = unwrapWholeFence(String(text ?? "").replace(/<!--[\s\S]*?(?:-->|$)/g, ""));
  if (outputCutOff(output) || (output.match(FINDING_BLOCK_RE)?.length ?? 0) !== findings.length) return false;
  const outside = output.replace(FINDING_BLOCK_RE, FINDING_PLACEHOLDER);
  if (quotesReportInFence(outside)) return false;
  const prose = withoutQuotedText(outside);
  if (INABILITY_RE.test(plainProse(prose.replace(new RegExp(NO_ISSUES_RE.source, "g"), "")))) return false;
  if ([...prose.matchAll(new RegExp(NO_ISSUES_RE.source, "g"))].some(([block]) => REVIEW_INABILITY_RE.test(plainProse(block)))) return false;
  return hasReport(outside, findings.length);
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

const TITLE_STOPWORDS = new Set(["the", "and", "for", "not", "but", "with", "from", "that", "this", "are", "was", "when", "can", "its", "into", "than", "then", "will", "has", "have"]);

function titleWords(summary) {
  const words = (String(summary || "").toLowerCase().match(/[a-z0-9_]{3,}/g) ?? []).filter(w => !TITLE_STOPWORDS.has(w));
  return new Set(words.map(w => (w.length > 4 ? w.replace(/(?:ing|ed|es|s)$/, "") : w)));
}

function normalizedTitle(summary) {
  return (String(summary || "").toLowerCase().match(/[a-z0-9_]+/g) ?? []).join(" ");
}

function isBlocker(f) {
  return ["p0", "p1"].includes(normalizeSeverity(f.severity));
}

function lineOf(f) {
  return Number.parseInt(f.line, 10) || 0;
}

// Two cold passes word the same issue differently, so a near match on place and title is a duplicate too.
function sameIssueNearby(a, b) {
  const file = f => (f.file || "").replace(/^\.?\//, "");
  if (!file(a) || file(a) !== file(b)) return false;
  const [la, lb] = [lineOf(a), lineOf(b)];
  if ((la === 0) !== (lb === 0) || Math.abs(la - lb) > NEARBY_LINES) return false;
  // A wrong merge loses a bug while a missed one only repeats a line, so two blockers merge only on the same title.
  if (isBlocker(a) && isBlocker(b)) return normalizedTitle(a.summary) === normalizedTitle(b.summary);
  const [wa, wb] = [titleWords(a.summary), titleWords(b.summary)];
  const shared = [...wa].filter(w => wb.has(w)).length;
  // A content word on each side that the other lacks names a different subject ("organization" vs "stream" filter).
  const subset = shared === Math.min(wa.size, wb.size);
  return subset && shared >= 2 && shared / Math.max(wa.size, wb.size) >= 0.5;
}

function dedupeFindings(agentResults) {
  const seen = new Map();
  const deduped = [];
  for (const f of agentResults.flatMap(r => r.findings)) {
    const key = `${(f.category || "").toLowerCase()}|${(f.summary || "").toLowerCase().slice(0, 120)}`;
    const existing = seen.get(key) ?? deduped.find(d => sameIssueNearby(d, f));
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
  const heading = bySeverity.p0.length > 0 ? "⛔ Blockers found" : "⚠️ Major concerns found";
  const callout = blocked ? `> [!CAUTION]\n> ### ${heading}` : "> [!NOTE]\n> ### 💬 Approved with comments";
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
