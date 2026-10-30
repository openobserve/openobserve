export const REVIEW_PASS_TAG = "<!--\\s*o2-review-pass:(\\d+)\\s*-->";

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
