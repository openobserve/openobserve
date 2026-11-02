// Handles a `/ai-review dispute <reason>` PR comment; ai-review-dispute.yml runs it from main, never with PR code.
import { ANY_REVIEW_MARKER, selectOwnReviewComment } from "./src/comments.mjs";
import { currentGateStatus, ghApi, postGateStatus } from "./src/gh-api.mjs";
import { checkDispute, disputeDescription, disputeNote, parseDispute } from "./src/verdict.mjs";

const env = process.env;
const repo = env.GITHUB_REPOSITORY;
const prNumber = env.PR_NUMBER;
const commenter = env.COMMENTER || "";
const botToken = env.BOT_TOKEN || undefined;

const reason = parseDispute(env.COMMENT_BODY);
if (reason === null) {
  console.log("Not a dispute command; nothing to do.");
  process.exit(0);
}

const pr = ghApi(`repos/${repo}/pulls/${prNumber}`);
const sha = pr.head.sha;
const current = currentGateStatus(repo, sha);
const verdict = checkDispute({
  commenter,
  commenterType: env.COMMENTER_TYPE,
  author: pr.user?.login,
  permission: permissionOf(commenter),
  reason,
  prState: pr.state,
  current,
});

if (!verdict.ok) {
  ghApi(`repos/${repo}/issues/${prNumber}/comments`, {
    method: "POST",
    token: botToken,
    body: { body: `@${commenter} dispute not accepted: ${verdict.reason} The AI review verdict is unchanged.` },
  });
  console.log(`Rejected dispute by ${commenter} on ${sha}: ${verdict.reason}`);
  process.exit(0);
}

postGateStatus(repo, sha, { state: "success", description: disputeDescription(commenter), targetUrl: env.COMMENT_URL });
console.log(`${sha}: success - ${disputeDescription(commenter)}`);

// The status above is what unblocks the merge; the reaction and the note are the audit trail, so their failures fail the job loudly.
try {
  ghApi(`repos/${repo}/issues/comments/${env.COMMENT_ID}/reactions`, { method: "POST", token: botToken, body: { content: "+1" } });
} catch (err) {
  console.error(`Could not react to the dispute comment: ${err.message}`);
  process.exitCode = 1;
}
try {
  appendNoteToReview(disputeNote(commenter, sha, reason));
} catch (err) {
  console.error(`Could not add the dispute note to the review comment: ${err.message}`);
  process.exitCode = 1;
}

// A failed lookup counts as no access, so an API error can only reject a dispute, never accept one.
function permissionOf(login) {
  if (!login) return "none";
  try {
    return ghApi(`repos/${repo}/collaborators/${encodeURIComponent(login)}/permission`).permission || "none";
  } catch (err) {
    console.warn(`Could not read ${login}'s permission, treating it as none: ${err.message}`);
    return "none";
  }
}

function appendNoteToReview(note) {
  const pages = ghApi(`repos/${repo}/issues/${prNumber}/comments?per_page=100`, { paginate: true });
  const review = selectOwnReviewComment((pages || []).flat(), env.BOT_LOGIN, ANY_REVIEW_MARKER);
  if (!review) throw new Error(`no review comment by ${env.BOT_LOGIN || "(no bot login)"} on #${prNumber}`);
  ghApi(`repos/${repo}/issues/comments/${review.id}`, { method: "PATCH", token: botToken, body: { body: `${review.body}\n\n${note}` } });
}
