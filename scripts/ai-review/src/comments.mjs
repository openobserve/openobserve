import { isSettledConfidenceLine, mergeConfidenceLine, reviewingConfidenceLine, staleConfidenceLine } from "./confidence.mjs";
import { scrubReviewBody } from "./scrub.mjs";

export const REVIEW_PASS_TAG = "<!--\\s*o2-review-pass:(\\d+)\\s*-->";
// The value class excludes `<` and `>` so a tag can neither cross into the next one nor backtrack across it.
export const REVIEW_SHA_TAG = "<!--\\s*o2-review-sha:([^\\s<>]+)\\s*-->";
// The verdict a later head's line replaced, kept in case the head returns to the reviewed commit.
export const REVIEW_HELD_TAG = "<!--\\s*o2-review-held:([^\\s<>]+)\\s*-->";
// Matched as a pattern so a retired leg's comment is still adopted; `[redacted]` is what redaction left in comments whose marker named the provider.
export const ANY_REVIEW_MARKER = "<!--\\s*ai-code-review[a-z0-9-]*(?:\\[redacted\\])?\\s*-->";
export const REVIEW_TITLE = "OpenObserve Code Review";
export const REVIEW_HEADING = `## 🔎 ${REVIEW_TITLE}`;
// Tolerates a missing glyph and the old "AI Code Review" heading so prompt drift still normalizes.
const REVIEW_HEADING_RE = /^#{1,3}[ \t]*(?:🔎[ \t]*)?(?:OpenObserve Code Review|AI Code Review)\b/mi;
const REVIEW_HEADING_LINE_RE = /^#{1,3}[ \t]*(?:🔎[ \t]*)?(?:OpenObserve Code Review|AI Code Review)\b[ \t]*[^\n]*$/mi;
// The runner writes the note, the commit line and the confidence line itself, so a copy echoed from the previous review is stripped.
const PASS_LIMIT_NOTE_RE = /\n*> \[!NOTE\]\n> This PR has used its \d+ automatic reviews[^\n]*/g;
const REVIEWED_COMMIT_LINE_RE = /\n*<sub>Reviewed commits? [^\n]*<\/sub>[ \t]*/g;
// Anchored to the line start so a finding that merely mentions the phrase survives; any leading punctuation or tag still counts as a forgery, but a backtick opens a finding's file path.
const MERGE_CONFIDENCE_LINE_RE = /^(?:[^\w\n`]|<\/?[a-z]+>)*merge[ \t]+confidence\b[^\n]*(?:\n|$)/gim;
const AUTO_APPROVE_LINE_RE = /^(?:[^\w\n`]|<\/?[a-z]+>)*(?:auto[- ]?approved|needs[ \t]+human[ \t]+review)\b[^\n]*(?:\n|$)/gim;
// Matched on letters alone, after tags and comments, so spacing, markup and lookalike punctuation cannot disguise a runner line.
const FORGED_LINE_RE = /mergeconfidence|autoapproved|needshumanreview|reviewedcommit/;
// The fixed head of a finding line, glyph and location then category, which leaves no room for a status phrase ahead of the category.
const FINDING_LINE_RE = /^\s*- (?:[^\w\s`*<]+\s+)?(?:`[^`\n]+`\s+)?\*\*\[[^\]\n]+\]\*\*/;
const TRAILING_TAGS_RE = /(?:\s*<!--\s*o2-review-(?:(?:sha|held):[^\s<>]+|pass:\d+)\s*-->)+\s*$/i;
const HTML_COMMENT_RE = /<!--[\s\S]*?--!?>/g;
const MARKUP_RE = /<!--[\s\S]*?--!?>|<[^>]*>|&[a-z]+;/gi;
// "summary" stays out: it would strip the <summary> of the findings fold, and a leaked finding field sits inside a stripped <finding> block.
const BOUNDARY_TAGS = ["mr_input", "mr_body", "mr_comments", "mr_details",
  "changed_files", "existing_inline_findings", "previous_review",
  "custom_review_instructions", "review_task", "pr_context", "diff",
  "all_findings", "coordinator_task", "overall_pr_context", "risk_tier",
  "reviewers_ran", "failed_reviewers", "reviewer", "findings", "finding", "no-issues",
  "category", "severity", "file", "line", "description", "suggestion"];
const BOUNDARY_TAG_RE = new RegExp(`</?(${BOUNDARY_TAGS.join("|")})[^>]*>`, "gi");

export function selectOwnReviewComment(comments, botLogin, markerPattern) {
  if (!botLogin) return null;
  const markerRe = new RegExp(markerPattern, "i");
  const own = comments.filter(c => c.user?.login === botLogin && markerRe.test(c.body || ""));
  return own.at(-1) ?? null;
}

// untagged is what a comment from before the counter is worth: a review is one pass, a pointer or notice none.
export function reviewPassCount(body, untagged = 1) {
  const m = (body || "").match(new RegExp(REVIEW_PASS_TAG, "i"));
  return m ? Number(m[1]) : untagged;
}

export function reviewPassTag(count) {
  return `<!-- o2-review-pass:${count} -->`;
}

export function withPassTag(body, count) {
  return `${withoutTag(body, REVIEW_PASS_TAG)}\n${reviewPassTag(count)}`;
}

// A new commit on either side of a paired review is a new key.
export function reviewKey(head, pairedHead) {
  if (!head) return "";
  return pairedHead ? `${head}+${pairedHead}` : head;
}

export function reviewedKey(body) {
  return (body || "").match(new RegExp(REVIEW_SHA_TAG, "i"))?.[1] ?? "";
}

export function reviewShaTag(key) {
  return `<!-- o2-review-sha:${key} -->`;
}

function withoutTag(body, tag) {
  return body.replace(new RegExp(`\\n?${tag}`, "gi"), "");
}

export function withReviewShaTag(body, key) {
  return `${withoutTag(body, REVIEW_SHA_TAG)}\n${reviewShaTag(key)}`;
}

export function shouldSkipAsReviewed(body, key, { ignorePassLimit = false, forceFull = false } = {}) {
  if (!key || ignorePassLimit || forceFull) return false;
  return reviewedKey(body) === key;
}

// 0 means no cap: anything but a positive integer leaves every new commit reviewable.
export function parseMaxPasses(value) {
  const text = String(value ?? "").trim();
  return /^\d+$/.test(text) ? Number(text) : 0;
}

export function passLimitReached(passes, maxPasses) {
  return maxPasses > 0 && passes >= maxPasses;
}

// Dedupe comes first so a queued run on a reviewed head stays silent instead of rewriting the limit note.
export function reviewSkipReason({ body, key, passesDone, maxPasses, ignorePassLimit = false, forceFull = false }) {
  if (shouldSkipAsReviewed(body, key, { ignorePassLimit, forceFull })) return "already_reviewed";
  if (!ignorePassLimit && passLimitReached(passesDone, maxPasses)) return "pass_limit_reached";
  return "";
}

function shortKey(key) {
  return key.split("+").map(sha => sha.slice(0, 7)).join("+");
}

// With a pair, HEAD_SHA is the enterprise PR and PAIRED_HEAD_SHA the OSS one.
export function reviewedCommitLine(key, review, maxPasses) {
  const [head, paired] = key.split("+").map(shortKey);
  const commits = paired
    ? `Reviewed commits \`${head}\` and \`${paired}\` (paired OSS PR)`
    : `Reviewed commit \`${head}\``;
  return `<sub>${commits} · review ${review}${maxPasses > 0 ? ` of ${maxPasses}` : ""}</sub>`;
}

export function passLimitNote(maxPasses, reviewed = "", head = "") {
  const scope = reviewed && head && reviewed !== head
    ? `. This review covers \`${shortKey(reviewed)}\`; \`${shortKey(head)}\` and later pushes are not reviewed.`
    : "; later pushes are not reviewed.";
  return `> [!NOTE]\n> This PR has used its ${maxPasses} automatic reviews${scope} Run the AI Code Review workflow by hand with \`ignore_pass_limit\` to review it again.`;
}

// Replaces any earlier note and stays above the hidden tags, so repeat skips neither stack notes nor lose tags.
export function withPassLimitNote(body, note) {
  const bare = body.replace(PASS_LIMIT_NOTE_RE, "");
  const tags = bare.match(TRAILING_TAGS_RE)?.[0] ?? "";
  return `${bare.slice(0, bare.length - tags.length).trimEnd()}\n\n${note}${tags}`;
}

// The blank lines stop Markdown pulling the note into the callout's blockquote.
export function insertAfterCallout(body, note) {
  if (!note) return body;
  const lines = body.split("\n");
  const heading = lines.findIndex(l => /^#{1,3}\s/.test(l));
  let at = heading + 1;
  const callout = lines.findIndex((l, i) => i > heading && /^>\s*\[!(?:TIP|NOTE|WARNING|CAUTION|IMPORTANT)\]/i.test(l));
  if (callout !== -1) {
    at = callout;
    while (at < lines.length && lines[at].startsWith(">")) at += 1;
  }
  lines.splice(at, 0, "", note, "");
  return lines.join("\n").replace(/\n{3,}/g, "\n\n");
}

// A gate verdict covers one commit, so it comes off as soon as a run for a later one claims the comment.
export function withoutAutoApproveLine(body) {
  return body.replace(AUTO_APPROVE_LINE_RE, "");
}

function withConfidenceLine(body, line) {
  return insertAfterCallout(withoutAutoApproveLine(body).replace(MERGE_CONFIDENCE_LINE_RE, ""), line);
}

function confidenceLineOf(body) {
  return (body.match(MERGE_CONFIDENCE_LINE_RE)?.[0] ?? "").trim();
}

function heldLine(body) {
  const encoded = body.match(new RegExp(REVIEW_HELD_TAG, "i"))?.[1];
  const line = encoded ? Buffer.from(encoded, "base64url").toString("utf-8") : "";
  return isSettledConfidenceLine(line) ? line : "";
}

// Base64 because a verdict's text is free to hold `-->`; only the first line replaced is the reviewed commit's verdict.
function withHeldVerdict(body) {
  const line = confidenceLineOf(body);
  if (!reviewedKey(body) || !isSettledConfidenceLine(line) || body.search(new RegExp(REVIEW_HELD_TAG, "i")) !== -1) return body;
  const tags = body.match(TRAILING_TAGS_RE)?.[0] ?? "";
  return `${body.slice(0, body.length - tags.length)}\n<!-- o2-review-held:${Buffer.from(line, "utf-8").toString("base64url")} -->${tags}`;
}

// The old verdict must not read as the new head's while the run works; a cancelled run leaving "Reviewing" behind is still true of what happened.
export function claimedReviewBody(body, count, key) {
  const bare = withoutAutoApproveLine(body);
  const newHead = key && reviewedKey(body) !== key && bare.search(MERGE_CONFIDENCE_LINE_RE) !== -1;
  return withPassTag(newHead ? withConfidenceLine(withHeldVerdict(bare), reviewingConfidenceLine(shortKey(key))) : bare, count);
}

// A head the review did not cover must not keep showing that review's confidence.
export function bodyAtUnreviewedHead(body, head) {
  const reviewed = reviewedKey(body);
  const covered = reviewed ? reviewed === head : body.search(MERGE_CONFIDENCE_LINE_RE) === -1;
  return head && !covered ? withConfidenceLine(withHeldVerdict(body), staleConfidenceLine(shortKey(head))) : body;
}

// Only for a head the sha tag covers. No held verdict means no level is claimed, and the gate's line stays off because its approval was dismissed.
export function bodyAtReviewedHead(body, maxPasses) {
  const line = confidenceLineOf(body);
  const held = body.search(new RegExp(REVIEW_HELD_TAG, "i")) !== -1;
  if (!held && (!line || isSettledConfidenceLine(line))) return body;
  const restored = withConfidenceLine(withoutTag(body, REVIEW_HELD_TAG), heldLine(body));
  return maxPasses > 0 && restored.search(PASS_LIMIT_NOTE_RE) !== -1 ? withPassLimitNote(restored, passLimitNote(maxPasses)) : restored;
}

export function bodyAtPassLimit(body, maxPasses, head) {
  return bodyAtUnreviewedHead(withPassLimitNote(body, passLimitNote(maxPasses, reviewedKey(body), head)), head);
}

// The sha tag says that exact commit was read and stops it being reviewed again, so a run that cannot prove that leaves it off.
export function finishReviewBody(body, { key, passes, maxPasses, reviewed, confidence, gateLine = "" }) {
  const stamped = reviewed && key;
  const lines = [confidence ? mergeConfidenceLine(confidence) : "", gateLine].filter(Boolean);
  let out = insertAfterCallout(body, lines.join("\n\n"));
  if (stamped) out += `\n\n${reviewedCommitLine(key, passes, maxPasses)}`;
  if (passLimitReached(passes, maxPasses)) out += `\n\n${passLimitNote(maxPasses)}`;
  if (stamped) out = withReviewShaTag(out, key);
  return withPassTag(out, passes);
}

// What the reviewers see as <previous_review>: the review alone, none of the runner's bookkeeping.
export function previousReviewText(body) {
  return [REVIEW_SHA_TAG, REVIEW_PASS_TAG, REVIEW_HELD_TAG].reduce(withoutTag, stripRunnerLines(String(body ?? "")));
}

// Yields the text after each pass, last the first that changed nothing: a removal can splice a new match out of what surrounds it.
function* removalPasses(text, pattern, replacement = "") {
  let out = text;
  let previous;
  do {
    previous = out;
    out = out.replace(pattern, replacement);
    yield out;
  } while (out !== previous);
}

export function removeRepeatedly(text, pattern, replacement) {
  let last = text;
  for (const pass of removalPasses(text, pattern, replacement)) last = pass;
  return last;
}

function lettersOf(text) {
  return text.normalize("NFKC").toLowerCase().replace(/[^a-z]/g, "");
}

// Every pass is judged, not only the last: a renderer does not rescan, so a comment rebuilt by one pass, which the next would swallow, is visible text.
function isForgedLine(line) {
  for (const pass of removalPasses(line, MARKUP_RE)) {
    if (FORGED_LINE_RE.test(lettersOf(pass))) return true;
  }
  return false;
}

function stripForgedLines(text) {
  const lines = removeRepeatedly(text, HTML_COMMENT_RE, comment => (comment.includes("\n") ? "" : comment)).split("\n");
  // A hidden real finding costs more than a cosmetic forgery, and the gate never reads these lines, so a finding's text is not judged.
  return lines.filter(line => !isForgedLine(line) || FINDING_LINE_RE.test(line)).join("\n");
}

function stripRunnerLines(text) {
  return stripForgedLines(text.replace(PASS_LIMIT_NOTE_RE, "").replace(REVIEWED_COMMIT_LINE_RE, "").replace(MERGE_CONFIDENCE_LINE_RE, "").replace(AUTO_APPROVE_LINE_RE, ""));
}

// The vendor prefix goes too, so "deepseek-v4-pro" and a bare "DeepSeek" are both caught; longest first because alternation is first-match.
export function redactProviderIdentity(text, { providerId, modelId }) {
  const vendor = String(modelId ?? "").split(/[-/_]/)[0];
  const terms = [providerId, modelId, vendor.length >= 4 ? vendor : null]
    .filter(Boolean)
    .sort((a, b) => b.length - a.length)
    .map(t => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  if (terms.length === 0) return text;
  return text.replace(new RegExp(terms.join("|"), "gi"), "[redacted]");
}

function unwrapJsonBody(body) {
  const trimmed = body.trim();
  if (!trimmed.startsWith("{") || !trimmed.endsWith("}")) return body;
  try {
    const parsed = JSON.parse(trimmed);
    return parsed.body && typeof parsed.body === "string" ? parsed.body : body;
  } catch {
    return body;
  }
}

// The marker is added last: it may name the provider, and a redacted marker no longer matches, so every run would post a new comment.
export function sanitizeReviewBody(body, { marker, providerId, modelId, env }) {
  if (!body) return { text: "", secretHits: 0 };
  const anyMarker = new RegExp(ANY_REVIEW_MARKER, "gi");
  const runnerTags = new RegExp(`${ANY_REVIEW_MARKER}|${REVIEW_PASS_TAG}|${REVIEW_SHA_TAG}|${REVIEW_HELD_TAG}`, "gi");

  let cleaned = unwrapJsonBody(body)
    .replace(/\\n/g, "\n")
    .replace(/\\t/g, "\t")
    .replace(/\\"/g, '"')
    .replace(BOUNDARY_TAG_RE, "");
  cleaned = stripRunnerLines(removeRepeatedly(cleaned, runnerTags));

  // Runs after marker stripping so a leading marker cannot anchor the search at index 0 and hide a preamble behind it.
  const headingAt = cleaned.search(REVIEW_HEADING_RE);
  if (headingAt > 0) cleaned = cleaned.slice(headingAt);
  cleaned = cleaned.trimStart().replace(REVIEW_HEADING_LINE_RE, REVIEW_HEADING);

  const scrubbed = scrubReviewBody(redactProviderIdentity(cleaned.trim(), { providerId, modelId }), env);
  // Stripped again because redaction can complete a marker the first pass did not recognise.
  return { text: `${marker}\n${scrubbed.text.replace(anyMarker, "").trimStart()}`, secretHits: scrubbed.secretHits };
}
