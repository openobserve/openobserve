import { removeRepeatedly } from "./comments.mjs";
import { LOADER_DIRS, LOADER_FILES } from "./sanitize.mjs";

export const MAX_APPROVE_LINES = 100;
export const MAX_APPROVE_FILES = 5;
// Reviewer prompts are cut at 150k characters with the PR text ahead of the diff, so a long body could push the diff out of view.
export const MAX_REVIEWED_CHARS = 100_000;
export const OPT_OUT_LABEL = "no-auto-approve";
export const SENSITIVE_PATHS = [
  /(?:^|\/)\.github\//i,
  /(?:^|\/)scripts(?:\/|$)/i,
  /^deploy\//i,
  /(?:^|\/)Dockerfile[^/]*$/i,
  /(?:^|\/)migration[^/]*\//i,
  /(?:^|\/)Cargo\.(?:toml|lock)$/i,
  /(?:^|\/)build\.rs$/i,
  /(?:^|\/)\.cargo\//i,
  /(?:^|\/)rust-toolchain[^/]*$/i,
  /(?:^|\/)\.?clippy\.toml$/i,
  /(?:^|\/)\.gitattributes$/i,
  /(?:^|\/)\.npmrc$/i,
  /(?:^|\/)\.husky\//i,
  /(?:^|\/)Makefile$/i,
  /\.config\.(?:ts|js|mjs|cjs)$/i,
  /(?:^|\/)package[^/]*\.json$/i,
  /(?:^|\/)(?:[^/]*\.lock|[^/]*-lock\.(?:json|ya?ml)|npm-shrinkwrap\.json|go\.sum)$/i,
  /^src\/config\/src\/config\.rs$/i,
  // Built from the sanitizer's own names, so whatever it treats as an instruction loader also needs a human.
  new RegExp(`(?:^|/)(?:${[...LOADER_FILES, ...LOADER_DIRS].map(name => name.replace(/[\\^$.*+?()[\]{}|]/g, "\\$&")).join("|")})(?:/|$)`, "i"),
  /(?:^|\/)\.?opencode[^/]*(?:\/|$)/i,
  /(?:^|\/)\.env[^/]*(?:\/|$)/i,
  /\.proto$/i,
  /auth|rbac|openfga|token|secret|crypt|password|session|permission|license|sso|oauth|saml/i,
];
// Run over normalizedText, so every space is a single one and every dash a plain hyphen.
const TRIPWIRE_RE = new RegExp([
  "ignore (?:(?:the|all|any|previous|prior) )+instructions",
  "system prompt",
  "approve this",
  "auto[- ]?approve",
  "do not flag",
  "no issues found",
  "lgtm",
  "<findings?",
  "no-issues",
  "o2-review",
  "ai-code-review",
  "ai-review-inline",
].join("|"));
// Run over letters alone, so "l.g.t.m" or a phrase split across two added lines still reads as written.
const SQUEEZED_TRIPWIRE_RE = /lgtm|systemprompt|ignore(?:all)?(?:the)?previous|noissuesfound|donotflag/;
// Each of these renders as nothing or as blank space, so text can hide behind or between them.
const INVISIBLE_RE = /[\u00AD\u034F\u061C\u180E\u200B-\u200F\u202A-\u202E\u2060-\u2064\u2066-\u206F\u2800\u3164\uFE00-\uFE0F\uFEFF\u{E0000}-\u{E007F}\u{E0100}-\u{E01EF}]/u;
// Code needs none of it, and a homoglyph reads as the word it copies to a human and past a phrase match.
const NON_ASCII_RE = /[^\t\x20-\x7E]/;
const LOOKALIKE_LETTER_RE = /[\p{Script=Cyrillic}\p{Script=Greek}]/u;
const COMMANDS_REASON = "reviewers can run commands";
const TRUSTED_ASSOCIATIONS = new Set(["OWNER", "MEMBER", "COLLABORATOR"]);
const REGULAR_FILE_MODE = "100644";
const SYMLINK_MODE = "120000";
const SUBMODULE_MODE = "160000";
const KNOWN_HEADER_RE = /^(?:index |--- |\+\+\+ |similarity index |dissimilarity index |rename |copy |old mode |new mode |new file mode |deleted file mode |Binary files |GIT binary patch|\\ |$)/;
const HUNK_RE = /^@@ -\d+(?:,(\d+))? \+\d+(?:,(\d+))? @@/;
const APPROVED_LINE = "**Auto-approved** — small change, all gates passed.";
const APPROVAL_BODY = "Auto-approved by the review gate: small change, all gates passed. CI must still pass before merge.";
const DISMISSAL_MESSAGE = "New commits arrived; an automatic approval does not carry over.";

export function parseAutoApproveMode(value) {
  return value === "shadow" || value === "approve" ? value : "off";
}

function headerPath(line) {
  const rest = line.slice("diff --git ".length);
  const size = (rest.length - 5) / 2;
  const path = rest.slice(2, 2 + size);
  return Number.isInteger(size) && rest === `a/${path} b/${path}` ? path : null;
}

function cleanPath(raw) {
  return raw.replace(/\t$/, "");
}

function readMode(mode, problems) {
  if (mode === SYMLINK_MODE) problems.add("a symlink changed");
  else if (mode === SUBMODULE_MODE) problems.add("a submodule changed");
  else if (mode !== REGULAR_FILE_MODE) problems.add("a file mode changed");
}

function readFileHeader(line, file, problems) {
  const path = /^(?:--- a\/|\+\+\+ b\/|rename from |rename to |copy from |copy to )(.*)$/.exec(line)?.[1];
  if (path !== undefined) {
    if (path.startsWith('"')) problems.add("a file path could not be read");
    file.paths.add(cleanPath(path));
    return;
  }
  if (/^(?:--- |\+\+\+ )/.test(line) && !/ \/dev\/null$/.test(line)) problems.add("a file path could not be read");
  if (line.startsWith("Binary files ") || line.startsWith("GIT binary patch")) problems.add("a binary file changed");
  if (line.startsWith("old mode ") || line.startsWith("new mode ")) problems.add("a file mode changed");
  const created = /^(?:new file|deleted file) mode (\d+)/.exec(line);
  if (created) readMode(created[1], problems);
  const indexMode = /^index \S+ (\d+)/.exec(line)?.[1];
  if (indexMode === SYMLINK_MODE || indexMode === SUBMODULE_MODE) readMode(indexMode, problems);
}

// Hunk-aware on purpose: an added line "++ x" reads as "+++ x", and a path-looking line inside a hunk must never count as a header.
export function parseRawDiff(diff) {
  const text = String(diff ?? "");
  const files = [];
  const addedLines = [];
  const problems = new Set(text.includes("\0") ? ["a binary file changed"] : []);
  let file = null;
  let changedLines = 0;
  let oldLeft = 0;
  let newLeft = 0;
  for (const line of text.split("\n")) {
    if (oldLeft > 0 || newLeft > 0) {
      if (line.startsWith("\\")) continue;
      if (line.startsWith("-")) { oldLeft -= 1; changedLines += 1; continue; }
      if (line.startsWith("+")) { newLeft -= 1; changedLines += 1; addedLines.push(line.slice(1)); continue; }
      oldLeft -= 1;
      newLeft -= 1;
      continue;
    }
    if (line.startsWith("diff --git ")) {
      const path = headerPath(line);
      file = { paths: new Set(path === null ? [] : [path]) };
      files.push(file);
      continue;
    }
    const hunk = HUNK_RE.exec(line);
    if (hunk && file) {
      oldLeft = hunk[1] === undefined ? 1 : Number(hunk[1]);
      newLeft = hunk[2] === undefined ? 1 : Number(hunk[2]);
      continue;
    }
    if (!KNOWN_HEADER_RE.test(line) || (!file && line)) { problems.add("the diff could not be parsed"); continue; }
    if (file) readFileHeader(line, file, problems);
  }
  if (oldLeft > 0 || newLeft > 0) problems.add("the diff is cut short");
  if (files.some(f => f.paths.size === 0)) problems.add("a file path could not be read");
  return { fileCount: files.length, changedLines, paths: files.flatMap(f => [...f.paths]), addedLines, problems: [...problems] };
}

export function sizeReasons(parsed) {
  const reasons = [...(parsed?.problems ?? [])];
  if (!(parsed?.fileCount > 0)) reasons.push("no files to judge");
  if (!(parsed?.fileCount <= MAX_APPROVE_FILES)) reasons.push(`more than ${MAX_APPROVE_FILES} files`);
  if (!(parsed?.changedLines <= MAX_APPROVE_LINES)) reasons.push(`more than ${MAX_APPROVE_LINES} changed lines`);
  return reasons;
}

export function isSensitivePath(path) {
  return SENSITIVE_PATHS.some(re => re.test(path));
}

function normalizedText(text) {
  return text.normalize("NFKC").toLowerCase().replace(/\p{Pd}/gu, "-").replace(/\s+/g, " ");
}

export function hasTripwire(texts) {
  const text = texts.map(raw => String(raw ?? "")).join("\n");
  const normalized = normalizedText(text);
  return INVISIBLE_RE.test(text) || TRIPWIRE_RE.test(normalized) || SQUEEZED_TRIPWIRE_RE.test(normalized.replace(/[^a-z]/g, ""));
}

export function hasNonAscii(texts) {
  return texts.some(raw => NON_ASCII_RE.test(String(raw ?? "")));
}

// NFKC first: a mathematical Greek letter is a Common-script symbol until it is normalized.
export function hasLookalikeLetters(texts) {
  return texts.some(raw => LOOKALIKE_LETTER_RE.test(String(raw ?? "").normalize("NFKC")));
}

// Only the exact approved block may render, alone, so a body that disagrees with an empty findings block cannot approve; a fence or HTML block ahead of it would turn it into quoted text.
export function isApprovedReview(text) {
  const visible = removeRepeatedly(String(text ?? ""), /<!--[\s\S]*?--!?>/g, "");
  const callouts = [...visible.matchAll(/^ {0,3}> ?\[![A-Za-z]+\]/gm)];
  const decision = /^> \[!TIP\]\n> ### ✅ Approved[ \t]*$/m.exec(visible);
  if (callouts.length !== 1 || decision?.index !== callouts[0].index) return false;
  return !/^ {0,3}(?:`{3,}|~{3,}|<)/m.test(visible.slice(0, decision.index));
}

function coverageReasons({ diff, diffPinned, filteredFileCount, reviewedChars, pr }) {
  const reasons = [];
  if (diffPinned !== true) reasons.push("the reviewed diff is not pinned to the head commit");
  if (filteredFileCount !== diff?.fileCount) reasons.push("not every file was reviewed");
  if (!(reviewedChars <= MAX_REVIEWED_CHARS)) reasons.push("the diff was truncated for the reviewers");
  if (pr?.changed_files !== diff?.fileCount || (pr?.additions ?? NaN) + (pr?.deletions ?? NaN) !== diff?.changedLines) {
    reasons.push("the diff does not match the PR's size");
  }
  return reasons;
}

function verdictReasons({ confidence, counts, reviewerFindingCount, findingsKnown, coordinatorFallback, decisionApproved }) {
  const reasons = [];
  if (confidence?.level !== "high") reasons.push("merge confidence is not high");
  const kept = Object.values(counts ?? { unknown: 1 }).reduce((sum, n) => sum + n, 0);
  if (kept !== 0 || reviewerFindingCount !== 0) reasons.push("there are findings");
  if (findingsKnown !== true) reasons.push("findings could not be counted");
  if (coordinatorFallback !== false) reasons.push("findings are un-judged");
  if (decisionApproved !== true) reasons.push("the review did not approve");
  return reasons;
}

function reviewerReasons(reviewers) {
  const list = Array.isArray(reviewers) ? reviewers : [];
  const done = key => list.some(r => r.key === key && r.ran === true && r.finished === true);
  const reasons = [];
  if (!done("security")) reasons.push("the Security reviewer did not finish");
  if (!done("correctness")) reasons.push("the Correctness reviewer did not finish");
  if (list.some(r => r.ran !== false && r.finished !== true)) reasons.push("a reviewer did not finish");
  if (list.length === 0 || list.some(r => r.ran !== false && r.fullDiff !== true)) reasons.push("a reviewer did not see the whole diff");
  return reasons;
}

// Parsed reviewer output is the only proof a reviewer looked; a clean exit with empty text is not.
export function reviewerFacts(results) {
  return results.map(r => ({ key: r.agentKey, ran: !r.skipped, finished: !r.skipped && !r.error && r.parsed === true, fullDiff: r.fullDiff === true }));
}

function pairingReasons({ paired, pairClear }) {
  const reasons = [];
  if (paired !== false) reasons.push("paired with another PR");
  if (pairClear !== true) reasons.push("the pairing check did not clear");
  return reasons;
}

function authorReasons(pr) {
  const login = String(pr?.user?.login ?? "");
  const reasons = [];
  if (!login || pr?.user?.type !== "User" || login.endsWith("[bot]")) reasons.push("the author is a bot");
  if (!TRUSTED_ASSOCIATIONS.has(pr?.author_association)) reasons.push("the author is not a project member");
  return reasons;
}

function hasOutstandingChangeRequest(reviews) {
  const latest = new Map();
  for (const r of reviews) {
    if (["APPROVED", "CHANGES_REQUESTED", "DISMISSED"].includes(r.state)) latest.set(r.user?.login ?? "", r.state);
  }
  return [...latest.values()].includes("CHANGES_REQUESTED");
}

function samePrText(reviewed, pr) {
  return ["title", "body"].every(field => String(reviewed[field] ?? "") === String(pr[field] ?? ""));
}

// What the reviewers read is what counts: an injection edited out before this check has still reached them.
function textReasons({ pr, diff, reviewedText }) {
  if (!pr || !diff) return ["suspicious text in the PR"];
  const changed = [...diff.paths, ...diff.addedLines];
  const prose = [reviewedText?.title, reviewedText?.body, pr.title, pr.body];
  const reasons = [];
  if (hasTripwire([...prose, ...changed])) reasons.push("suspicious text in the PR");
  if (hasNonAscii(changed)) reasons.push("non-ASCII text in the change");
  if (hasLookalikeLetters(prose)) reasons.push("lookalike letters in the title or body");
  if (!reviewedText) reasons.push("the text given to the reviewers is unknown");
  else if (!samePrText(reviewedText, pr)) reasons.push("the title or body changed after the review started");
  return reasons;
}

function blockReasons({ pr, reviews }) {
  const reasons = [];
  const labels = pr?.labels;
  if (!Array.isArray(labels) || labels.some(l => String(l?.name).toLowerCase() === OPT_OUT_LABEL)) reasons.push("opted out of auto-approve");
  if (!Array.isArray(reviews) || hasOutstandingChangeRequest(reviews)) reasons.push("changes were requested");
  return reasons;
}

function headReasons({ pr, headSha }) {
  const reasons = [];
  if (!headSha || pr?.head?.sha !== headSha) reasons.push("the head moved");
  if (pr?.state !== "open" || pr?.draft !== false) reasons.push("the PR is not open and ready");
  if (pr?.base?.ref !== "main") reasons.push("the PR does not target main");
  return reasons;
}

// Every value is read as "not proven" when missing, so an incomplete input can never come out eligible.
export function autoApproveDecision(input = {}) {
  const { diff, reviewConfig, staleCleared } = input;
  const reasons = [
    ...(reviewConfig === "default" ? [] : [COMMANDS_REASON]),
    ...sizeReasons(diff),
    ...coverageReasons(input),
    ...(diff?.paths?.length > 0 && !diff.paths.some(isSensitivePath) ? [] : ["touches a sensitive path"]),
    ...verdictReasons(input),
    ...reviewerReasons(input.reviewers),
    ...pairingReasons(input),
    ...authorReasons(input.pr),
    ...textReasons(input),
    ...blockReasons(input),
    ...headReasons(input),
    ...(staleCleared === true ? [] : ["an earlier approval could not be dismissed"]),
  ];
  return { eligible: reasons.length === 0, eligibleIgnoringConfig: reasons.every(r => r === COMMANDS_REASON), reasons: [...new Set(reasons)] };
}

// `api` is { readPr, listReviews, dismissReview, approve }, injected so the no-write modes can be proven.
export function createAutoApproveGate({ mode, api, botLogin, headSha, warn = () => {} }) {
  let staleCleared = false;
  const ownApprovals = reviews => reviews.filter(r => r.user?.login === botLogin && r.state === "APPROVED");

  function dismissOwnApprovals() {
    if (!botLogin) {
      warn("no reviewer app identity, so earlier approvals cannot be found");
      return false;
    }
    let cleared = true;
    for (const review of ownApprovals(api.listReviews())) {
      try {
        api.dismissReview(review.id, DISMISSAL_MESSAGE);
      } catch (err) {
        cleared = false;
        warn(`could not dismiss review ${review.id}: ${err.message}`);
      }
    }
    return cleared;
  }

  function submitApproval(reviews) {
    if (ownApprovals(reviews).some(r => r.commit_id === headSha)) return true;
    try {
      api.approve({ event: "APPROVE", commit_id: headSha, body: APPROVAL_BODY });
      return true;
    } catch (err) {
      warn(`could not submit the approval: ${err.message}`);
      return false;
    }
  }

  return {
    active: mode !== "off",
    // Must run before the reviewers start: a small approval must not outlive the commit it covered, even if this run dies.
    start() {
      if (mode === "off") return;
      if (mode === "shadow") {
        staleCleared = true;
        return;
      }
      try {
        staleCleared = dismissOwnApprovals();
      } catch (err) {
        warn(`could not list earlier approvals: ${err.message}`);
      }
    },
    conclude(facts) {
      if (mode === "off") return null;
      let pr;
      let reviews;
      try {
        pr = api.readPr();
        reviews = api.listReviews();
      } catch (err) {
        warn(`could not re-read the PR: ${err.message}`);
      }
      const decision = autoApproveDecision({ ...facts, pr, reviews, headSha, staleCleared });
      const result = { mode, eligible: decision.eligible, eligible_ignoring_config: decision.eligibleIgnoringConfig, reasons: decision.reasons, approved: false };
      if (mode !== "approve" || !decision.eligible) return result;
      result.approved = submitApproval(reviews);
      if (!result.approved) result.reasons = ["the approval could not be submitted"];
      return result;
    },
  };
}

export function autoApproveLine(result) {
  if (result?.mode !== "approve") return "";
  return result.approved ? APPROVED_LINE : `**Needs human review** — ${result.reasons.join("; ")}`;
}
