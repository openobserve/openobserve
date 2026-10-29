export const REVIEW_PASS_TAG = "<!--\\s*o2-review-pass:(\\d+)\\s*-->";

export function selectOwnReviewComment(comments, botLogin, markerPattern) {
  if (!botLogin) return null;
  const markerRe = new RegExp(markerPattern, "i");
  const own = comments.filter(c => c.user?.login === botLogin && markerRe.test(c.body || ""));
  return own.at(-1) ?? null;
}

// A review posted before the counter existed carries no tag but is still one pass.
export function reviewPassCount(body) {
  const m = (body || "").match(new RegExp(REVIEW_PASS_TAG, "i"));
  return m ? Number(m[1]) : 1;
}

export function reviewPassTag(count) {
  return `<!-- o2-review-pass:${count} -->`;
}
