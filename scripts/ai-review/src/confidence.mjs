import { SEVERITIES, normalizeSeverity } from "./severity.mjs";

const CONFIDENCE_LABEL = { high: "🟢 High", medium: "🟡 Medium", low: "🔴 Low" };
// "unknown" is a reviewer that rejected before reporting its name; it may have been either of these.
const CORE_REVIEWER_RE = /^(?:security|correctness|unknown)\b/i;
const TEST_PATH_RE = /(?:^|\/)(?:tests|__tests__|test)\/|\.(?:spec|test)\.[^/]*$/;
// o2_* are the enterprise crates, whose sources do not sit under a top-level src/.
const PROD_PATH_RE = /^(?:src|web\/src|o2_[^/]+\/src)\//;
const RUST_TEST_ADDED_RE = /^\+\s*#\[(?:test\]|tokio::test\b|cfg\(test\)\])/m;

export function shortName(agentName) {
  return String(agentName || "unknown").replace(/\s+Reviewer$/i, "");
}

export function severityCounts(findings) {
  const counts = Object.fromEntries(SEVERITIES.map(s => [s, 0]));
  for (const f of findings) counts[normalizeSeverity(f.severity)] += 1;
  return counts;
}

// A reviewer that returned nothing parseable counts as unfinished, or its silence would read as a clean pass.
export function reviewerFinished(r) {
  return !r.skipped && !r.error && r.parsed === true;
}

export function unfinishedReviewers(ranResults) {
  return ranResults.filter(r => !reviewerFinished(r)).map(r => r.agentName);
}

function plural(count, noun) {
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
}

function highReason(prodChanged) {
  return `no blockers; all reviewers finished${prodChanged ? "; tests changed" : ""}`;
}

// Computed from facts only, so neither a PR nor the model can talk the level up.
export function mergeConfidence({
  counts = {},
  findingsKnown = true,
  failedReviewers = [],
  ranCount,
  coordinatorFallback = false,
  prodChanged = false,
  testsChanged = false,
}) {
  if (ranCount === 0) return { level: "low", reasons: ["no reviewer ran"] };
  if (ranCount > 0 && failedReviewers.length >= ranCount) return { level: "low", reasons: ["no reviewer finished"] };

  const blockers = (counts.p0 ?? 0) + (counts.p1 ?? 0);
  const core = failedReviewers.filter(name => CORE_REVIEWER_RE.test(shortName(name)));
  const other = failedReviewers.filter(name => !core.includes(name));
  const unfinished = name => `${shortName(name)} reviewer did not finish`;
  const low = [
    ...(blockers > 0 ? [`${plural(blockers, "blocker")} (P0/P1)`] : []),
    ...(findingsKnown ? [] : ["findings could not be counted"]),
    ...core.map(unfinished),
  ];
  const medium = [
    ...other.map(unfinished),
    ...(coordinatorFallback ? ["findings are un-judged"] : []),
    ...((counts.p2 ?? 0) > 0 ? [plural(counts.p2, "P2 finding")] : []),
    ...(prodChanged && !testsChanged ? ["no tests changed"] : []),
  ];
  if (low.length > 0) return { level: "low", reasons: [...low, ...medium] };
  if (medium.length > 0) return { level: "medium", reasons: medium };
  return { level: "high", reasons: [highReason(prodChanged)] };
}

export function mergeConfidenceLine({ level, reasons }) {
  return `**Merge confidence: ${CONFIDENCE_LABEL[level]}** — ${reasons.join("; ")}`;
}

export function staleConfidenceLine(shortHead) {
  return `**Merge confidence: ${CONFIDENCE_LABEL.low}** — \`${shortHead}\` has not been reviewed`;
}

export function reviewingConfidenceLine(shortHead) {
  return `**Merge confidence: 🟡 Reviewing** — \`${shortHead}\` is being reviewed`;
}

// A Rust test added beside the code counts as test evidence without making that file any less production code.
export function changedCodeEvidence(diff, pairedDir = "") {
  const prefix = pairedDir ? `${pairedDir.replace(/\/+$/, "")}/` : "";
  let prodChanged = false;
  let testsChanged = false;
  for (const section of String(diff ?? "").split(/^diff --git /m)) {
    const raw = /^a\/.*? b\/(.*?)\n/.exec(section)?.[1];
    if (!raw) continue;
    const path = prefix && raw.startsWith(prefix) ? raw.slice(prefix.length) : raw;
    const testPath = TEST_PATH_RE.test(path);
    if (testPath || (path.endsWith(".rs") && RUST_TEST_ADDED_RE.test(section))) testsChanged = true;
    if (!testPath && PROD_PATH_RE.test(path)) prodChanged = true;
  }
  return { prodChanged, testsChanged };
}
