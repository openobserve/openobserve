export const STATUS_CONTEXT = "AI review verdict";
export const DISPUTE_PREFIX = "Disputed by @";
export const DISPUTE_COMMAND = "/ai-review dispute";

const MAX_DESCRIPTION = 140;
const MAX_REASON = 300;
const WRITE_PERMISSIONS = new Set(["admin", "maintain", "write"]);

// Order matters: "Approved with comments" must be tried before "Approved".
const VERDICT_HEADINGS = [
  ["significant_concerns", /significant concerns/i, "Significant concerns"],
  ["minor_issues", /minor issues/i, "Minor issues"],
  ["approved_with_comments", /approved with comments/i, "Approved with comments"],
  ["approved", /approved/i, "Approved"],
  ["not_reviewed", /not reviewed/i, "Not reviewed"],
];

const LABELS = Object.fromEntries(VERDICT_HEADINGS.map(([verdict, , label]) => [verdict, label]));

export function verdictFromReview(body) {
  for (const line of (body || "").split("\n")) {
    const heading = line.match(/^\s*(?:>\s*)?#{1,6}\s+(.*)$/);
    if (!heading) continue;
    const hit = VERDICT_HEADINGS.find(([, re]) => re.test(heading[1]));
    if (hit) return hit[0];
  }
  return "unknown";
}

export function isDisputeStatus(status) {
  return status?.state === "success" && (status.description || "").startsWith(DISPUTE_PREFIX);
}

// Returns the status to post, or null to leave the current one: a re-review never re-blocks a commit a maintainer disputed.
export function gateStatus({ skip = "", pairedRef = "", basis = "", verdict = "", current = null }) {
  const next = nextGateStatus({ skip, pairedRef, basis, verdict });
  if (next.state === "failure" && isDisputeStatus(current)) return null;
  return { ...next, description: next.description.slice(0, MAX_DESCRIPTION) };
}

function nextGateStatus({ skip, pairedRef, basis, verdict }) {
  if (skip === "fork") return { state: "success", description: "Fork PRs are not AI-reviewed" };
  if (pairedRef) return { state: "success", description: `Reviewed with ${pairedRef}; that PR carries the verdict` };
  if (basis === "no_changes") return { state: "success", description: "No reviewable changes" };
  const carried = basis === "pass_limit" ? " (last review; pass limit reached)" : "";
  if (verdict === "significant_concerns") {
    const fix = carried ? "Re-run with ignore_pass_limit" : "Fix";
    return { state: "failure", description: `Significant concerns${carried}. ${fix}, or a maintainer comments ${DISPUTE_COMMAND} <reason>` };
  }
  if (verdict in LABELS && verdict !== "not_reviewed") return { state: "success", description: `${LABELS[verdict]}${carried}` };
  // An infra failure or a missing verdict must never block a merge.
  return { state: "success", description: "Not reviewed (run failed or gave no verdict); not blocking" };
}

// Returns null when the comment is not a dispute command, else the trimmed reason (possibly empty).
export function parseDispute(body) {
  const text = (body || "").trim();
  if (!text.toLowerCase().startsWith(DISPUTE_COMMAND)) return null;
  const rest = text.slice(DISPUTE_COMMAND.length);
  if (rest && !/^\s/.test(rest)) return null;
  return rest.trim();
}

export function checkDispute({ commenter, commenterType, author, permission, reason, prState, current }) {
  if (prState !== "open") return { ok: false, reason: "this PR is not open." };
  if (commenterType === "Bot" || /\[bot\]$/i.test(commenter || "")) return { ok: false, reason: "bots cannot dispute a review." };
  if (!commenter || commenter === author) return { ok: false, reason: "the PR author cannot dispute their own review; ask another maintainer." };
  if (!WRITE_PERMISSIONS.has(permission)) return { ok: false, reason: "only users with write, maintain or admin access can dispute." };
  if (!reason) return { ok: false, reason: `a reason is required: \`${DISPUTE_COMMAND} <reason>\`.` };
  if (current?.state !== "failure") {
    return { ok: false, reason: "the current head commit has no blocking AI review verdict to dispute (it may still be under review)." };
  }
  return { ok: true };
}

export function disputeDescription(commenter) {
  return `${DISPUTE_PREFIX}${commenter}`.slice(0, MAX_DESCRIPTION);
}

// The reason lands inside the bot's comment, so HTML is stripped: a planted marker or pass tag would change how the comment is read back.
export function disputeNote(commenter, sha, reason) {
  const clean = reason.replace(/[<>]/g, "").replace(/\s+/g, " ").trim().slice(0, MAX_REASON);
  return `> **Disputed by @${commenter}** on \`${sha.slice(0, 7)}\`: ${clean}`;
}
